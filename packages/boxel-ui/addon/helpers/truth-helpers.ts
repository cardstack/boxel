export function eq<T>(a: T, b: T): boolean {
  return a === b;
}

export function lt<T>(a: T, b: T): boolean {
  return a < b;
}

export function gt<T>(a: T, b: T): boolean {
  return a > b;
}

export function and<T>(...args: [T | any, T | any, ...T[]]): boolean {
  for (let i = 0; i < args.length; i++) {
    if (!args[i] || args[i] === false) {
      return false;
    }
  }
  return true;
}

export function or<T>(...args: [T, T, ...T[]]): boolean {
  for (let i = 0; i < args.length; i++) {
    if (args[i] || args[i] === true) {
      return true;
    }
  }
  return false;
}

export function not<T>(val: T): boolean {
  if (!val || val === false) {
    return true;
  }
  return false;
}

export function bool<T>(val: T): boolean {
  return Boolean(val);
}
