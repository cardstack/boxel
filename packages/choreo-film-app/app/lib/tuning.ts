/**
 * The films declare their tunable numbers where they use them, with a label
 * and a range for a tuning panel. The app has no panel, so each one is its
 * default.
 */
export function tuneNumber(
  _id: string,
  original: number,
  _label: string,
  _min?: number,
  _max?: number,
  _step?: number
): number {
  return original;
}
