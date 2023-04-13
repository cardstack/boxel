export function withPreventDefault(fn: () => void) {
  return (ev: MouseEvent) => {
    ev.preventDefault();
    fn();
  };
}
