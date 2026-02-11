import { readFirstBytes } from '@cardstack/runtime-common';
import { ImageDef } from './image-file-def';
import { type ByteStream, type SerializedFile } from './file-api';
import { extractGifDimensions } from './gif-meta-extractor';

export class GifDef extends ImageDef {
  static displayName = 'GIF Image';

  static async extractAttributes(
    url: string,
    getStream: () => Promise<ByteStream>,
    options: { contentHash?: string } = {},
  ): Promise<SerializedFile<{ width: number; height: number }>> {
    let base = await super.extractAttributes(url, getStream, options);
    let bytes = await readFirstBytes(await getStream(), 10);
    let { width, height } = extractGifDimensions(bytes);

    return {
      ...base,
      width,
      height,
    };
  }
}
