// How a raster image encodes its pixels, read from the container's own header.
//
// Each image format states this in its own way — PNG in IHDR, JPEG in the frame
// header, GIF in the logical screen descriptor, WebP per bitstream flavor — so
// the per-format reader lives in that format's `*-meta-extractor` module and
// they all return this one shape. That's what lets a query ask "which images
// have an alpha channel" without caring what encoded them.
//
// Every property is optional, and absence is meaningful: a format that cannot
// tell us its bit depth leaves `bitDepth` unset rather than guessing 8, and a
// format with no alpha concept leaves `hasAlpha` unset rather than reporting
// `false` — "no alpha channel" and "we couldn't tell" are different answers.

export interface ImageColorProfile {
  // A slug from the shared `color-space` vocabulary in
  // `file-formats/metadata-fields`, wrapped by the caller into a CodedValue.
  colorSpace?: string;
  // Bits per channel, not per pixel: a 24-bit RGB image is 8-bit here, which
  // is how every image format and every color tool states it.
  bitDepth?: number;
  channels?: number;
  hasAlpha?: boolean;
  iccProfile?: string;
}

// Drop the keys that came back undefined so a format that learned nothing
// yields no attribute at all rather than an empty object in the index row.
export function prunedColorProfile(
  candidate: ImageColorProfile,
): ImageColorProfile | undefined {
  let entries = Object.entries(candidate).filter(
    ([, value]) => value !== undefined,
  );
  return entries.length > 0
    ? (Object.fromEntries(entries) as ImageColorProfile)
    : undefined;
}
