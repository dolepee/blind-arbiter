import { deploySepoliaEscrow, initializeSepoliaEscrowEnvironment } from "./sepolia-escrow-lib.mjs";

await initializeSepoliaEscrowEnvironment();

const deployment = await deploySepoliaEscrow();
console.log(JSON.stringify(deployment, null, 2));
