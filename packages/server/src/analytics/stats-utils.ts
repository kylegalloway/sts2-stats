// Wilson score lower bound for a proportion with n observations (z=1.645 → 95% CI one-sided).
// Returns a confidence-adjusted estimate that shrinks toward 0 for small n.
export function wilsonLower(successes: number, n: number): number {
  if (n === 0) return 0;
  const z = 1.645;
  const p = successes / n;
  return (p + z * z / (2 * n) - z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n)) / (1 + z * z / n);
}
