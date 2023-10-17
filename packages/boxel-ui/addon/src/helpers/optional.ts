export default function optional<T>(action: T | undefined): T | (() => void) {
  if (typeof action === 'function') {
    return action;
  }
  return () => {};
}
