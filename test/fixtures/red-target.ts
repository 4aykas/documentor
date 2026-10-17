// A target for test/guardrails/red.test.ts to put a defect into: nothing
// else imports it, so mutating it cannot disturb a test running beside it.
export function refuseNegative(n: number): boolean {
  if (n < 0) return true;
  return false;
}
