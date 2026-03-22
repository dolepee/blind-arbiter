export const READ_ONLY_MESSAGE =
  "This public deployment is a read-only proof site. Live case execution stays on the operator environment.";

export function isReadOnlyDeployment() {
  return process.env.VERCEL === "1" || process.env.BLIND_ARBITER_READ_ONLY === "1";
}
