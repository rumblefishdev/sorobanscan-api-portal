import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { BackendStack } from "../lib/backend-stack.ts";

const TOPIC = "arn:aws:sns:eu-central-1:111111111111:x402-production-alarms";
const CONTEXT = { discordClientId: "1", alarmTopicArn: TOPIC };

/** `aws:cdk:bundling-stacks: []` keeps esbuild from bundling the function in a unit test. */
function synth(context: Record<string, unknown> = CONTEXT): Template {
  const app = new App({ context: { "aws:cdk:bundling-stacks": [], ...context } });
  const stack = new BackendStack(app, "SorobanscanHub-production-Backend", {
    env: { account: "111111111111", region: "eu-central-1" },
  });
  return Template.fromStack(stack);
}

const SECRET_PREFIX = "sorobanscan-hub/production";
const FUNCTION_NAME = "sorobanscan-hub-production-backend";
const HOST_PARAMETER = "/sorobanscan-hub/production/backend-host";

/** Every `secretsmanager:GetSecretValue` statement's resources, flattened to one string each. */
function readableSecrets(template: Template): string[] {
  const out: string[] = [];
  for (const policy of Object.values(template.findResources("AWS::IAM::Policy"))) {
    const statements = policy.Properties.PolicyDocument.Statement as Array<{
      Action: string | string[];
      Resource: unknown;
    }>;
    for (const s of statements) {
      const actions = ([] as string[]).concat(s.Action);
      if (!actions.includes("secretsmanager:GetSecretValue")) continue;
      for (const r of ([] as unknown[]).concat(s.Resource)) out.push(JSON.stringify(r));
    }
  }
  return out;
}

describe("BackendStack", () => {
  const template = synth();

  it("has one function, by its fixed name: Node 22, arm64, 29 s, 512 MB, 20 reserved", () => {
    template.resourceCountIs("AWS::Lambda::Function", 1);
    template.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: FUNCTION_NAME,
      Runtime: "nodejs22.x",
      Architectures: ["arm64"],
      Timeout: 29,
      MemorySize: 512,
      ReservedConcurrentExecutions: 20,
    });
  });

  it("gives the function the six names and no secret's value", () => {
    const [fn] = Object.values(template.findResources("AWS::Lambda::Function"));
    const vars = fn?.Properties.Environment.Variables as Record<string, unknown>;
    const allowed = [
      "HUB_PUBLIC_ORIGIN",
      "HUB_PRODUCTS",
      "DISCORD_CLIENT_ID",
      "HUB_DISCORD_SECRET_NAME",
      "HUB_SESSION_SECRET_NAME",
      "HUB_ORIGIN_SECRET_NAME",
    ];
    const names = Object.keys(vars).filter((n) => n !== "NODE_OPTIONS");
    expect(names.sort()).toEqual([...allowed].sort());
    expect(vars.HUB_PUBLIC_ORIGIN).toBe("https://sorobanscan.com");
    expect(vars.HUB_PRODUCTS).toBe("prices,x402");
    expect(vars.DISCORD_CLIENT_ID).toBe("1");
    expect(vars.HUB_DISCORD_SECRET_NAME).toBe(`${SECRET_PREFIX}/discord-client-secret`);
    expect(Object.keys(vars)).not.toContain("DISCORD_CLIENT_SECRET");
    expect(Object.keys(vars)).not.toContain("HUB_SESSION_SECRET");
  });

  it("has one function URL with no authentication", () => {
    template.resourceCountIs("AWS::Lambda::Url", 1);
    template.hasResourceProperties("AWS::Lambda::Url", { AuthType: "NONE" });
  });

  it("lets anyone invoke the function URL, through both permissions AWS asks for", () => {
    template.hasResourceProperties("AWS::Lambda::Permission", {
      Action: "lambda:InvokeFunctionUrl",
      Principal: "*",
      FunctionUrlAuthType: "NONE",
    });
    template.hasResourceProperties("AWS::Lambda::Permission", {
      Action: "lambda:InvokeFunction",
      Principal: "*",
      InvokedViaFunctionUrl: true,
    });
  });

  it("makes the session and origin secrets, retained except on a failed create, 64 characters, no punctuation", () => {
    template.resourceCountIs("AWS::SecretsManager::Secret", 2);
    template.hasResource("AWS::SecretsManager::Secret", {
      DeletionPolicy: "RetainExceptOnCreate",
      UpdateReplacePolicy: "Retain",
      Properties: {
        Name: `${SECRET_PREFIX}/session`,
        GenerateSecretString: { PasswordLength: 64, ExcludePunctuation: true },
      },
    });
    template.hasResource("AWS::SecretsManager::Secret", {
      DeletionPolicy: "RetainExceptOnCreate",
      UpdateReplacePolicy: "Retain",
      Properties: {
        Name: `${SECRET_PREFIX}/origin-secret`,
        GenerateSecretString: {
          PasswordLength: 64,
          ExcludePunctuation: true,
          SecretStringTemplate: "{}",
          GenerateStringKey: "current",
        },
      },
    });
  });

  it("lets the role read five secrets and no more", () => {
    const resources = readableSecrets(template);
    expect(resources).toHaveLength(5);
    const joined = resources.join("\n");
    // The two the stack makes are referenced by logical id, the three it doesn't by name.
    for (const name of ["discord-client-secret", "prices-token", "x402-token"]) {
      // A by-name ARN has no suffix of its own: IAM needs the wildcard for the six characters.
      expect(joined).toContain(`${SECRET_PREFIX}/${name}-??????`);
    }
    expect(resources.filter((r) => /"Ref":"(Session|Origin)Secret/.test(r))).toHaveLength(2);
    expect(resources).not.toContain('"*"');
  });

  it("has no inline policy statement on Resource * (the managed basic-execution role grants logs on *)", () => {
    expect(Object.keys(template.findResources("AWS::IAM::Policy")).length).toBeGreaterThan(0);
    for (const policy of Object.values(template.findResources("AWS::IAM::Policy"))) {
      for (const s of policy.Properties.PolicyDocument.Statement as Array<{
        Action: string | string[];
        Resource: unknown;
      }>) {
        if (s.Resource === "*") {
          throw new Error(`Resource * on ${JSON.stringify(s.Action)}`);
        }
      }
    }
  });

  it("keeps the log group, by its fixed name, for one month", () => {
    template.resourceCountIs("AWS::Logs::LogGroup", 1);
    template.hasResourceProperties("AWS::Logs::LogGroup", {
      LogGroupName: `/aws/lambda/${FUNCTION_NAME}`,
      RetentionInDays: 30,
    });
  });

  it("writes the function URL's host into the SSM parameter the explorer reads", () => {
    template.resourceCountIs("AWS::SSM::Parameter", 1);
    template.hasResourceProperties("AWS::SSM::Parameter", {
      Name: HOST_PARAMETER,
      Type: "String",
      // `https://<id>.lambda-url.eu-central-1.on.aws/` split on `/`: the third piece is the host.
      Value: {
        "Fn::Select": [
          2,
          {
            "Fn::Split": [
              "/",
              { "Fn::GetAtt": [Match.stringLikeRegexp("FunctionUrl"), "FunctionUrl"] },
            ],
          },
        ],
      },
    });
  });

  it("outputs the names the explorer takes, and never the host", () => {
    template.hasOutput("OriginSecretName", { Value: `${SECRET_PREFIX}/origin-secret` });
    template.hasOutput("BackendHostParameterName", { Value: HOST_PARAMETER });
    const outputs = template.toJSON().Outputs as Record<string, unknown>;
    expect(Object.keys(outputs).sort()).toEqual(["BackendHostParameterName", "OriginSecretName"]);
    expect(JSON.stringify(outputs)).not.toContain("FunctionUrl");
  });

  describe("alarms, to the topic named by alarmTopicArn", () => {
    function alarm(name: string): Record<string, unknown> {
      const found = Object.values(template.findResources("AWS::CloudWatch::Alarm")).filter(
        (a) => a.Properties.AlarmName === name,
      );
      expect(found).toHaveLength(1);
      return found[0]?.Properties as Record<string, unknown>;
    }
    const [functionId] = Object.keys(template.findResources("AWS::Lambda::Function"));

    it("has exactly two", () => {
      template.resourceCountIs("AWS::CloudWatch::Alarm", 2);
    });

    it.each([
      ["sorobanscan-hub-production-backend-throttles", "Throttles", 1],
      ["sorobanscan-hub-production-backend-url-5xx", "Url5xxCount", 5],
    ])("%s: the Sum of %s over 5 minutes at %d or more", (name, metric, threshold) => {
      expect(alarm(name)).toMatchObject({
        Namespace: "AWS/Lambda",
        MetricName: metric,
        Dimensions: [{ Name: "FunctionName", Value: { Ref: functionId } }],
        Statistic: "Sum",
        Period: 300,
        EvaluationPeriods: 1,
        Threshold: threshold,
        ComparisonOperator: "GreaterThanOrEqualToThreshold",
        TreatMissingData: "notBreaching",
        AlarmActions: [TOPIC],
      });
      expect(alarm(name)).not.toHaveProperty("OKActions");
    });
  });

  it("stops without discordClientId, naming it", () => {
    expect(() => synth({})).toThrow(/discordClientId/);
  });

  it("stops without alarmTopicArn, or with one that is not an SNS topic's ARN, naming it", () => {
    expect(() => synth({ discordClientId: "1" })).toThrow(/alarmTopicArn/);
    expect(() => synth({ ...CONTEXT, alarmTopicArn: "x402-production-alarms" })).toThrow(
      /alarmTopicArn/,
    );
  });

  describe("functionUrl=off, the first half of a new host", () => {
    const off = synth({ ...CONTEXT, functionUrl: "off" });

    it("has no function URL, no public permission and no host parameter", () => {
      off.resourceCountIs("AWS::Lambda::Url", 0);
      off.resourceCountIs("AWS::Lambda::Permission", 0);
      off.resourceCountIs("AWS::SSM::Parameter", 0);
    });

    it("keeps the function, its log group, its secrets and both alarms", () => {
      off.resourceCountIs("AWS::Lambda::Function", 1);
      off.hasResourceProperties("AWS::Lambda::Function", { FunctionName: FUNCTION_NAME });
      off.resourceCountIs("AWS::Logs::LogGroup", 1);
      off.resourceCountIs("AWS::SecretsManager::Secret", 2);
      off.resourceCountIs("AWS::CloudWatch::Alarm", 2);
    });

    it("refuses any other value, naming it", () => {
      expect(() => synth({ ...CONTEXT, functionUrl: "false" })).toThrow(/functionUrl/);
    });
  });
});
