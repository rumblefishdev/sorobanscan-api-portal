import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { BackendStack } from "../lib/backend-stack.ts";

/** `aws:cdk:bundling-stacks: []` keeps esbuild from bundling the function in a unit test. */
function synth(context: Record<string, unknown> = { discordClientId: "1" }): Template {
  const app = new App({ context: { "aws:cdk:bundling-stacks": [], ...context } });
  const stack = new BackendStack(app, "SorobanscanHub-production-Backend", {
    env: { account: "111111111111", region: "eu-central-1" },
  });
  return Template.fromStack(stack);
}

const SECRET_PREFIX = "sorobanscan-hub/production";

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

  it("has one function: Node 22, arm64, 29 s, 512 MB, 20 reserved", () => {
    template.resourceCountIs("AWS::Lambda::Function", 1);
    template.hasResourceProperties("AWS::Lambda::Function", {
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

  it("makes the session and origin secrets, retained, 64 characters, no punctuation", () => {
    template.resourceCountIs("AWS::SecretsManager::Secret", 2);
    template.hasResource("AWS::SecretsManager::Secret", {
      DeletionPolicy: "Retain",
      UpdateReplacePolicy: "Retain",
      Properties: {
        Name: `${SECRET_PREFIX}/session`,
        GenerateSecretString: { PasswordLength: 64, ExcludePunctuation: true },
      },
    });
    template.hasResource("AWS::SecretsManager::Secret", {
      DeletionPolicy: "Retain",
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
      expect(joined).toContain(`${SECRET_PREFIX}/${name}`);
    }
    expect(resources.filter((r) => /"Ref":"(Session|Origin)Secret/.test(r))).toHaveLength(2);
    expect(resources).not.toContain('"*"');
  });

  it("has no statement on Resource * except the log group's own", () => {
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

  it("keeps the log group for one month", () => {
    template.hasResourceProperties("AWS::Logs::LogGroup", { RetentionInDays: 30 });
  });

  it("outputs the function URL's host and the origin secret's name", () => {
    template.hasOutput("FunctionUrlHost", Match.anyValue());
    template.hasOutput("OriginSecretName", { Value: `${SECRET_PREFIX}/origin-secret` });
  });

  it("stops without discordClientId, naming it", () => {
    expect(() => synth({})).toThrow(/discordClientId/);
  });
});
