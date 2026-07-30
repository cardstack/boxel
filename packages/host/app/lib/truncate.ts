// Cut a string to a budget, marking the cut so a truncated value cannot be read
// as a whole one. The marker counts against the budget, so the result never
// exceeds it — which is what lets a caller treat the budget as a real ceiling
// rather than an approximate one.
//
// The marker is the caller's choice because the audience differs: prose a person
// reads can afford to say `[truncated]`, while a telemetry field measured in a few
// hundred characters cannot spend a dozen of them on boilerplate.
export const TRUNCATION_MARKER = '…';

export function truncate(value: string, max: number, marker?: string): string;
export function truncate(
  value: undefined,
  max: number,
  marker?: string,
): undefined;
export function truncate(
  value: string | undefined,
  max: number,
  marker?: string,
): string | undefined;
export function truncate(
  value: string | undefined,
  max: number,
  marker: string = TRUNCATION_MARKER,
): string | undefined {
  if (value == null || value.length <= max) {
    return value;
  }
  return value.slice(0, Math.max(0, max - marker.length)) + marker;
}
