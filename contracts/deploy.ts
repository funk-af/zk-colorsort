import { deploy } from "./deploy-config";

async function main(): Promise<void> {
  await deploy();
  console.log("Deployment complete");
}

void main()
  .then(() => {
    // snarkjs keeps worker threads alive after deriving the verifier lsig;
    // exit explicitly so the script does not hang.
    process.exit(0);
  })
  .catch((error: unknown) => {
    console.error("Deployment failed", error);
    process.exit(1);
  });
