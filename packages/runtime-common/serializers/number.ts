import type {
  BaseDefConstructor,
  BaseInstanceType,
} from 'https://cardstack.com/base/card-api';

export function queryableValue(val: number | undefined): number | undefined {
  return val != null ? val : undefined;
}

export function serialize(val: number | null): number | undefined {
  return val != null ? val : undefined;
}

export function validate(value: string | number | null): string | null {
  if (value == null || value === '') {
    return null;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return 'Input must be a finite number.';
    }
  } else {
    if (value.endsWith('.')) {
      return 'Input cannot end with a decimal point.';
    }

    const number = Number(value);

    if (Number.isNaN(number)) {
      return 'Input must be a valid number.';
    }

    let minSafe = Number.MIN_SAFE_INTEGER;
    let maxSafe = Number.MAX_SAFE_INTEGER;

    if (number > maxSafe || number < minSafe) {
      return `Input number is out of safe range. Please enter a number between ${minSafe} and ${maxSafe}.`;
    }
  }

  return null;
}

export async function deserialize<T extends BaseDefConstructor>(
  this: T,
  number: any,
): Promise<BaseInstanceType<T>> {
  return deserializeSync(number) as BaseInstanceType<T>;
}

export function deserializeSync(number: any): number | null {
  const validationError = validate(number);
  if (validationError) {
    return null;
  }

  if (number == null || number === '') {
    return null;
  }

  if (typeof number === 'number') {
    return number;
  }

  if (typeof number === 'string') {
    const parsed = Number(number);
    return Number.isNaN(parsed) ? null : parsed;
  }

  return null;
}
