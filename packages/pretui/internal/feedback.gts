// Pretui — pixel sizing shared by Spinner and ProgressRadial.
import { resolveSize } from '../pretui-primitives';
import type { PretuiSize } from '../pretui-primitives';

// Spinner and ProgressRadial take `@size` in PIXELS — they are drawn boxes,
// not em-scaled controls. An agent reaching for the kit's scale writes
// `@size='sm'` and used to get `width: smpx`, i.e. a size declaration the
// browser drops on the floor with no error anywhere. The house enum now
// resolves to the pixel step it names; a raw number still wins.

/** A `@size` that may be a raw pixel number or any spelling of the scale. */
export function resolvePixelSize(
  size: number | string | undefined,
  scale: Record<PretuiSize, number>,
  fallback: PretuiSize = 'm',
): number {
  if (typeof size === 'number') {
    return size;
  }
  return scale[resolveSize(size, fallback)];
}
