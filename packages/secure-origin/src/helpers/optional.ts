type AnyFunction = (...args: any[]) => unknown;

// boxel-ui's `optional`: the action given, or one that does nothing.
export default function optional<T extends AnyFunction>(
  action: T | undefined,
): T {
  return (action ?? ((..._args: unknown[]) => {})) as T;
}
