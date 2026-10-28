// boxel-ui's truth helpers, the ones the package's templates use.

export function eq<T>(a: T, b: T): boolean {
  return a === b;
}

export function and<T>(...args: [T, T, ...T[]]): boolean {
  return args.every(Boolean);
}

export function or<T>(...args: [T, T, ...T[]]): boolean {
  return args.some(Boolean);
}

export function gt(a: number, b: number): boolean {
  return a > b;
}

export function not<T>(val: T): boolean {
  return !val;
}

export function bool<T>(val: T): boolean {
  return Boolean(val);
}
