export function eq<T>(a: T, b: T): boolean {
  return a === b;
}
export function gt<T>(a: T, b: T): boolean {
  return a > b;
}
export function not(a: any): boolean {
  return !a;
}
export function or(a: boolean, b: boolean): boolean {
  return a || b;
}
