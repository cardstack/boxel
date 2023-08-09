export default function approximatelyEqual(
  a: number,
  b: number,
  precision = 0.01,
): boolean {
  return Math.abs(a - b) < precision;
}
