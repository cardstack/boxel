import { readFirstBytes } from '@cardstack/runtime-common';
import GifIcon from '@cardstack/boxel-icons/gif';
import {
  RasterImageDef,
  rasterImageAttributes,
  type RasterImageAttributes,
} from './image-file-def';
import type { ByteStream, SerializedFile } from './file-api';
import {
  extractGifColorProfile,
  extractGifDimensions,
} from './gif-meta-extractor';

// 6-byte signature plus the 7-byte logical screen descriptor, which holds the
// dimensions and the global color table's size.
const GIF_SCREEN_DESCRIPTOR_BYTES = 13;

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
    let bytes = await readFirstBytes(
      await getStream(),
      GIF_SCREEN_DESCRIPTOR_BYTES,
    );
    let { width, height } = extractGifDimensions(bytes);

    return {
      ...base,
      width,
      height,
      // GIF has no EXIF.
      ...rasterImageAttributes(undefined, extractGifColorProfile(bytes)),
    };
  }
}
