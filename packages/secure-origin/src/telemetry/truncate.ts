// Cut a string to a budget, marking the cut so a truncated value cannot be read
// as a whole one. The marker counts against the budget, so the result never
// exceeds it.
export function truncate(value: string, max: number, marker = '…'): string {
  if (value.length <= max) {
    return value;
  }
  return value.slice(0, Math.max(0, max - marker.length)) + marker;
}
