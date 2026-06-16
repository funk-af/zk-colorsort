import { deploy } from "./deploy-config";

async function main(): Promise<void> {
  await deploy();
  console.log("Deployment complete");
}

void main().catch((error: unknown) => {
  console.error("Deployment failed", error);
  process.exitCode = 1;
});
