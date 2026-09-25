// What a container-walking animation reader concluded from the bytes it was
// given. The two non-answers differ in what more bytes can do: `needs-bytes`
// means the prefix ended before the walk reached a deciding structure, so a
// longer prefix may still answer; `undecidable` means the walk hit something it
// can't read past (a bad signature, an unrecognized block), so no amount of
// further reading will. A caller streaming the file stops on anything but
// `needs-bytes`.
export type AnimationVerdict =
  | 'animated'
  | 'still'
  | 'needs-bytes'
  | 'undecidable';

export function isFinalAnimationVerdict(verdict: AnimationVerdict): boolean {
  return verdict !== 'needs-bytes';
}

// The verdict as the attribute-level answer: animated, still, or unknown.
export function animatedFromVerdict(
  verdict: AnimationVerdict,
): boolean | undefined {
  return verdict === 'animated'
    ? true
    : verdict === 'still'
      ? false
      : undefined;
}
