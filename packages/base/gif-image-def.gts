import { readBytesUntil } from '@cardstack/runtime-common';
import GifIcon from '@cardstack/boxel-icons/gif';
import {
  RasterImageDef,
  rasterImageAttributes,
  type RasterImageAttributes,
} from './image-file-def';
import type { ByteStream, SerializedFile } from './file-api';
import {
  extractGifAnimated,
  extractGifColorProfile,
  extractGifDimensions,
} from './gif-meta-extractor';

// The dimensions and the global color table's size sit in the first 13 bytes
// (signature plus logical screen descriptor), but deciding whether the file
// animates means walking its blocks to a second frame or the trailer. The read
// stops as soon as the walk decides, so the cap bounds only a large still GIF
// or a huge first frame; past it `animation` is left unset, which the srcset
// gate treats as possibly animated.
const GIF_READ_WINDOW_BYTES = 1_048_576;

export class GifDef extends RasterImageDef {
  static displayName = 'GIF Image';
  static icon = GifIcon;
  static acceptTypes = '.gif,image/gif';

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
      GIF_READ_WINDOW_BYTES,
      (prefix) => extractGifAnimated(prefix) !== undefined,
    );
    let { width, height } = extractGifDimensions(bytes);

    return {
      ...base,
      width,
      height,
      // GIF has no EXIF.
      ...rasterImageAttributes(
        undefined,
        extractGifColorProfile(bytes),
        extractGifAnimated(bytes),
      ),
    };
  }
}

export default GifDef;
