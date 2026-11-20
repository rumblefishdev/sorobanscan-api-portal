/*
 * The hub's backend (`bff/`) as one Lambda behind a public function URL. CloudFront is the
 * only caller that matters: it sends the shared header the function checks (`origin-secret`), so
 * the URL itself carries no authentication.
 *
 * The stack holds no secret's value. It makes the two secrets it can generate (the session's and
 * the header's), and takes the other three by name: Discord's client secret and the two products'
 * token secrets are put there by hand.
 */
import { CfnOutput, Duration, Fn, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Architecture, FunctionUrlAuthType, Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import type { Construct } from "constructs";
import { fileURLToPath } from "node:url";

const SECRET_PREFIX = "sorobanscan-hub/production";
const ROOT = fileURLToPath(new URL("../../", import.meta.url));

export class BackendStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const discordClientId = this.node.tryGetContext("discordClientId") as unknown;
    if (typeof discordClientId !== "string" || discordClientId === "") {
      throw new Error("The context value discordClientId is required: -c discordClientId=<id>");
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
      retention: RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const fn = new NodejsFunction(this, "Function", {
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

    const url = fn.addFunctionUrl({ authType: FunctionUrlAuthType.NONE });

    new CfnOutput(this, "FunctionUrlHost", { value: hostOf(url.url) });
    new CfnOutput(this, "OriginSecretName", { value: `${SECRET_PREFIX}/origin-secret` });
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
