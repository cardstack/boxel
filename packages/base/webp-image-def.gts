import { readFirstBytes } from '@cardstack/runtime-common';
import {
  RasterImageDef,
  rasterImageAttributes,
  type RasterImageAttributes,
} from './image-file-def';
import type { ByteStream, SerializedFile } from './file-api';
import {
  extractWebpColorProfile,
  extractWebpDimensions,
} from './webp-meta-extractor';

// The RIFF header plus the first chunk's own header, which is where every WebP
// flavor states both its dimensions and whether it carries alpha.
const WEBP_HEADER_BYTES = 30;

export class WebpDef extends RasterImageDef {
  static displayName = 'WebP Image';
  static acceptTypes = '.webp,image/webp';

  static async extractAttributes(
    url: string,
    getStream: () => Promise<ByteStream>,
    options: { contentHash?: string } = {},
  ): Promise<
    SerializedFile<{ width: number; height: number } & RasterImageAttributes>
  > {
    let base = await super.extractAttributes(url, getStream, options);
    let bytes = await readFirstBytes(await getStream(), WEBP_HEADER_BYTES);
    let { width, height } = extractWebpDimensions(bytes);

    return {
      ...base,
      width,
      height,
      // WebP can carry EXIF in a trailing `EXIF` chunk, past the window this
      // header-only pass reads.
      ...rasterImageAttributes(undefined, extractWebpColorProfile(bytes)),
    };
  }
}
