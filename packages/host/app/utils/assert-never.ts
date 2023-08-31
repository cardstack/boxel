export function assertNever(value: never) {
  return new Error(`should never happen ${value}`);
}
