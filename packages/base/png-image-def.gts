import { readBytesUntil } from '@cardstack/runtime-common';
import PngIcon from '@cardstack/boxel-icons/file-type-png';
import {
  RasterImageDef,
  rasterImageAttributes,
  type RasterImageAttributes,
} from './image-file-def';
import type { ByteStream, SerializedFile } from './file-api';
import {
  extractPngAnimated,
  extractPngColorProfile,
  extractPngDimensions,
} from './png-meta-extractor';

// IHDR is always PNG's first chunk and is fixed-length, so dimensions, bit
// depth, and color type live in the first 33 bytes. Whether the file animates
// is decided by the chunks between IHDR and the first IDAT, where an APNG's
// `acTL` must sit; the read stops as soon as that walk decides. Past the cap
// `animation` is left unset, and for a PNG unset keeps srcset — so an APNG
// with more than this many bytes of ancillary chunks ahead of its `acTL`
// renders from frozen renditions. Encoders conventionally write `acTL` right
// after IHDR, which keeps that to files with a large chunk inserted ahead of it.
const PNG_READ_WINDOW_BYTES = 65_536;

export class PngDef extends RasterImageDef {
  static displayName = 'PNG Image';
  static icon = PngIcon;
  static acceptTypes = '.png,image/png';

  static async extractAttributes(
    url: string,
    getStream: () => Promise<ByteStream>,
    options: { contentHash?: string } = {},
  ): Promise<
    SerializedFile<{ width: number; height: number } & RasterImageAttributes>
  > {
    let base = await super.extractAttributes(url, getStream, options);
    let bytes = await readBytesUntil(
      await getStream(),
      PNG_READ_WINDOW_BYTES,
      (prefix) => extractPngAnimated(prefix) !== undefined,
    );
    let { width, height } = extractPngDimensions(bytes);

    return {
      ...base,
      width,
      height,
      // PNG carries no EXIF in IHDR. An `eXIf` chunk can appear anywhere
      // before IEND; the chunk walk here only looks for `acTL` and stops at
      // the first IDAT, so EXIF isn't read.
      ...rasterImageAttributes(
        undefined,
        extractPngColorProfile(bytes),
        extractPngAnimated(bytes),
      ),
    };
  }
}

export default PngDef;
