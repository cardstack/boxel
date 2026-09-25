import { readFirstBytes } from '@cardstack/runtime-common';
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
// animates means walking its blocks to a second frame or the trailer. The walk
// stops early on either, so the window only bounds a large still GIF or a huge
// first frame; past it `animation` is left unset rather than guessed.
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
    let bytes = await readFirstBytes(await getStream(), GIF_READ_WINDOW_BYTES);
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
