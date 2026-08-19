import { readFirstBytes } from '@cardstack/runtime-common';
import {
  RasterImageDef,
  rasterImageAttributes,
  type RasterImageAttributes,
} from './image-file-def';
import type { ByteStream, SerializedFile } from './file-api';
import {
  extractAvifColorProfile,
  extractAvifDimensions,
} from './avif-meta-extractor';

// The AVIF ispe box is typically within the first few KB, but can follow
// other ISOBMFF boxes. 64 KB covers virtually all real-world files.
const AVIF_MAX_HEADER_BYTES = 65_536;

export class AvifDef extends RasterImageDef {
  static displayName = 'AVIF Image';
  static acceptTypes = '.avif,image/avif';

  static async extractAttributes(
    url: string,
    getStream: () => Promise<ByteStream>,
    options: { contentHash?: string } = {},
  ): Promise<
    SerializedFile<{ width: number; height: number } & RasterImageAttributes>
  > {
    let base = await super.extractAttributes(url, getStream, options);
    let bytes = await readFirstBytes(await getStream(), AVIF_MAX_HEADER_BYTES);
    let { width, height } = extractAvifDimensions(bytes);

    return {
      ...base,
      width,
      height,
      // AVIF stores EXIF as a separate metadata item elsewhere in the box tree;
      // the item-location walk that reaches it isn't part of this pass.
      ...rasterImageAttributes(undefined, extractAvifColorProfile(bytes)),
    };
  }
}

export default AvifDef;
