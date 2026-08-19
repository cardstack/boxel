import { readFirstBytes } from '@cardstack/runtime-common';
import PngIcon from '@cardstack/boxel-icons/file-type-png';
import {
  RasterImageDef,
  rasterImageAttributes,
  type RasterImageAttributes,
} from './image-file-def';
import type { ByteStream, SerializedFile } from './file-api';
import {
  extractPngColorProfile,
  extractPngDimensions,
} from './png-meta-extractor';

// IHDR is always PNG's first chunk and is fixed-length, so everything this
// reads — dimensions, bit depth, color type — lives in the first 33 bytes:
// 8-byte signature, 8-byte chunk header, 13 bytes of IHDR data, 4-byte CRC.
const PNG_IHDR_BYTES = 33;

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
    let bytes = await readFirstBytes(await getStream(), PNG_IHDR_BYTES);
    let { width, height } = extractPngDimensions(bytes);

    return {
      ...base,
      width,
      height,
      // PNG carries no EXIF in IHDR. A `eXIf` chunk can appear later in the
      // file; reading it means walking chunks, which this header-only pass
      // deliberately doesn't do.
      ...rasterImageAttributes(undefined, extractPngColorProfile(bytes)),
    };
  }
}

export default PngDef;
