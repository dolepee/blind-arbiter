import {
  formatJson,
  initializeSepoliaEscrowEnvironment,
  runSepoliaEscrowSmokeTest,
} from "./sepolia-escrow-lib.mjs";

await initializeSepoliaEscrowEnvironment();

const report = await runSepoliaEscrowSmokeTest();
console.log(formatJson(report));
