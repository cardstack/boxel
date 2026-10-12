/**
 * The demos declare their tunable values where they use them — a spring, a
 * tween, a duration — with a label a tuning panel would show. The gallery has
 * no tuning panel, so each one is its declared value.
 */
export function tuneObject<T>(_id: string, original: T, _label?: string): T {
  return original;
}

export const tuneMotion = tuneObject;
export const tuneSpring = tuneObject;
export const tuneVariants = tuneObject;

export function tuneNumber(
  _id: string,
  original: number,
  _label?: string,
  _min?: number,
  _max?: number,
  _step?: number,
): number {
  return original;
}

export function tuneSeconds(
  _id: string,
  original: number,
  _label?: string,
): number {
  return original;
}
