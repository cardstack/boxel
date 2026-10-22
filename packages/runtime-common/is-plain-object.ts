// A non-null object that isn't an array. Dependency-free, so any module in
// this package can read it.
export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
