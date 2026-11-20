import { App } from "aws-cdk-lib";
import { BackendStack } from "../lib/backend-stack.ts";

const app = new App();

// No account lookup: the account comes from the CLI's credentials when there are any, and the
// stack is account-agnostic without them, so `synth` needs none.
new BackendStack(app, "SorobanscanHub-production-Backend", {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: "eu-central-1" },
});
