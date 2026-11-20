/*
 * The hub's backend (`bff/`) as one Lambda behind a public function URL. CloudFront is the
 * only caller that matters: it sends the shared header the function checks (`origin-secret`), so
 * the URL itself carries no authentication.
 *
 * The stack holds no secret's value. It makes the two secrets it can generate (the session's and
 * the header's), and takes the other three by name: Discord's client secret and the two products'
 * token secrets are put there by hand.
 *
 * The function URL's host is in neither repo, both public: the stack writes it into an SSM
 * parameter, which the explorer's stack reads by name when it deploys.
 */
import { CfnOutput, Duration, Fn, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import {
  Alarm,
  ComparisonOperator,
  Metric,
  TreatMissingData,
  type IMetric,
} from "aws-cdk-lib/aws-cloudwatch";
import { SnsAction } from "aws-cdk-lib/aws-cloudwatch-actions";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Architecture, FunctionUrlAuthType, Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import { Topic } from "aws-cdk-lib/aws-sns";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import type { Construct } from "constructs";
import { fileURLToPath } from "node:url";

const SECRET_PREFIX = "sorobanscan-hub/production";
/**
 * Fixed, so the runbook and the alarms can name it. Set before the stack's first deploy: a new
 * name later would replace the function, and its URL with it, under a new host.
 */
const FUNCTION_NAME = "sorobanscan-hub-production-backend";
const HOST_PARAMETER = "/sorobanscan-hub/production/backend-host";
const ROOT = fileURLToPath(new URL("../../", import.meta.url));

export class BackendStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const discordClientId = this.node.tryGetContext("discordClientId") as unknown;
    if (typeof discordClientId !== "string" || discordClientId === "") {
      throw new Error("The context value discordClientId is required: -c discordClientId=<id>");
    }
    // stellar-x402's `x402-production-alarms`, which goes to Slack. From the command line, so the
    // account's id is not in git either.
    const alarmTopicArn = this.node.tryGetContext("alarmTopicArn") as unknown;
    if (
      typeof alarmTopicArn !== "string" ||
      !/^arn:aws:sns:[a-z0-9-]+:\d{12}:[\w-]+$/.test(alarmTopicArn)
    ) {
      throw new Error(
        "The context value alarmTopicArn is required, an SNS topic's ARN: -c alarmTopicArn=<arn>",
      );
    }
    // `off` deploys the stack without its function URL: the first of the two deploys that give
    // the function a new host (the runbook's "If the function URL's host leaked").
    const functionUrl = this.node.tryGetContext("functionUrl") as unknown;
    if (functionUrl !== undefined && functionUrl !== "off") {
      throw new Error("The context value functionUrl takes only off: -c functionUrl=off");
    }

    const generated = { passwordLength: 64, excludePunctuation: true } as const;
    // Kept when the stack is deleted or a secret replaced, so its value outlives a mistake; not
    // when the stack's first deploy fails. A rollback that kept them would leave both names taken,
    // and the next deploy, which must create them, would fail with "already exists".
    const sessionSecret = new Secret(this, "SessionSecret", {
      secretName: `${SECRET_PREFIX}/session`,
      removalPolicy: RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
      generateSecretString: generated,
    });
    const originSecret = new Secret(this, "OriginSecret", {
      secretName: `${SECRET_PREFIX}/origin-secret`,
      removalPolicy: RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
      generateSecretString: {
        ...generated,
        secretStringTemplate: "{}",
        generateStringKey: "current",
      },
    });
    const byName = (name: string) =>
      Secret.fromSecretNameV2(this, `Existing-${name}`, `${SECRET_PREFIX}/${name}`);
    const discordSecret = byName("discord-client-secret");
    const pricesToken = byName("prices-token");
    const x402Token = byName("x402-token");

    const logGroup = new LogGroup(this, "Logs", {
      logGroupName: `/aws/lambda/${FUNCTION_NAME}`,
      retention: RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const fn = new NodejsFunction(this, "Function", {
      functionName: FUNCTION_NAME,
      entry: `${ROOT}bff/src/lambda.ts`,
      handler: "handler",
      depsLockFilePath: `${ROOT}pnpm-lock.yaml`,
      projectRoot: ROOT,
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      timeout: Duration.seconds(29),
      memorySize: 512,
      reservedConcurrentExecutions: 20,
      logGroup,
      environment: {
        HUB_PUBLIC_ORIGIN: "https://sorobanscan.com",
        HUB_PRODUCTS: "prices,x402",
        DISCORD_CLIENT_ID: discordClientId,
        HUB_DISCORD_SECRET_NAME: `${SECRET_PREFIX}/discord-client-secret`,
        HUB_SESSION_SECRET_NAME: `${SECRET_PREFIX}/session`,
        HUB_ORIGIN_SECRET_NAME: `${SECRET_PREFIX}/origin-secret`,
      },
      bundling: {
        // `@aws-sdk/*` stays external (the default): production runs the Lambda runtime's SDK, not
        // the tested one; `readFromAws`'s own abort still bounds a read.
        format: OutputFormat.ESM,
        target: "node22",
        minify: true,
        sourceMap: false,
        // ESM bundles of CommonJS dependencies still call `require`.
        banner:
          "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
      },
    });

    // Exactly these five secrets, and only to read their value.
    fn.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["secretsmanager:GetSecretValue"],
        resources: [
          sessionSecret.secretArn,
          originSecret.secretArn,
          withSuffix(discordSecret.secretArn),
          withSuffix(pricesToken.secretArn),
          withSuffix(x402Token.secretArn),
        ],
      }),
    );

    if (functionUrl !== "off") {
      // One URL per function and qualifier: a new logical id here would not give a new host, as
      // CloudFormation creates the new URL before it deletes the old one, and Lambda refuses it.
      const url = fn.addFunctionUrl({ authType: FunctionUrlAuthType.NONE });
      new StringParameter(this, "BackendHost", {
        parameterName: HOST_PARAMETER,
        stringValue: hostOf(url.url),
        description: "The hub's function URL host, for the explorer's distribution. Never public.",
      });
    }

    // Throttles: the function URL answers 429 to everybody once the 20 instances are busy (and
    // past 10 times that in requests a second). 5xx: function errors, timeouts, an instance that
    // can't read its secrets (`startup_failed`), a product that doesn't answer. Missing data is a
    // quiet hour, not a fault. No OK message: both count events, as stellar-x402's count alarms.
    const action = new SnsAction(Topic.fromTopicArn(this, "AlarmTopic", alarmTopicArn));
    const alarm = (id: string, suffix: string, metric: IMetric, threshold: number, what: string) =>
      new Alarm(this, id, {
        alarmName: `${FUNCTION_NAME}-${suffix}`,
        alarmDescription: `${what} See sorobanscan-api-portal's docs/runbook.md, "The alarms".`,
        metric,
        threshold,
        comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        evaluationPeriods: 1,
        treatMissingData: TreatMissingData.NOT_BREACHING,
      }).addAlarmAction(action);
    const fiveMinutes = { period: Duration.minutes(5), statistic: "Sum" } as const;
    alarm(
      "ThrottlesAlarm",
      "throttles",
      fn.metricThrottles(fiveMinutes),
      1,
      "Lambda throttled the hub's backend: its function URL answered 429.",
    );
    alarm(
      "Url5xxAlarm",
      "url-5xx",
      new Metric({
        namespace: "AWS/Lambda",
        metricName: "Url5xxCount",
        dimensionsMap: { FunctionName: fn.functionName },
        ...fiveMinutes,
      }),
      5,
      "The hub's function URL answered 5 or more 5xx in 5 minutes.",
    );

    new CfnOutput(this, "OriginSecretName", { value: `${SECRET_PREFIX}/origin-secret` });
    new CfnOutput(this, "BackendHostParameterName", { value: HOST_PARAMETER });
  }
}

/**
 * `fromSecretNameV2` gives an ARN without the six characters Secrets Manager appends to every
 * secret's, which IAM would never match; `-??????` stands for them.
 */
function withSuffix(arn: string): string {
  return `${arn}-??????`;
}

/** `https://abc.lambda-url.eu-central-1.on.aws/` as its host, resolved at deploy time. */
function hostOf(url: string): string {
  // The URL is a token; CloudFormation splits it, as the origin of a distribution wants.
  return Fn.select(2, Fn.split("/", url));
}
