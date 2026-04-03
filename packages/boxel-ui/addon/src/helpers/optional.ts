type AnyFunction = (...args: any[]) => unknown;

export default function optional<T extends AnyFunction>(
  action: T | undefined,
): T {
  return (action ?? ((..._args: unknown[]) => {})) as T;
}
