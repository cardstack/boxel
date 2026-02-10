import { readFirstBytes } from '@cardstack/runtime-common';
import { ImageDef } from './image-file-def';
import { type ByteStream, type SerializedFile } from './file-api';
import { extractWebpDimensions } from './webp-meta-extractor';

export class WebpDef extends ImageDef {
  static displayName = 'WebP Image';

  static async extractAttributes(
    url: string,
    getStream: () => Promise<ByteStream>,
    options: { contentHash?: string } = {},
  ): Promise<SerializedFile<{ width: number; height: number }>> {
    let base = await super.extractAttributes(url, getStream, options);
    let bytes = await readFirstBytes(await getStream(), 30);
    let { width, height } = extractWebpDimensions(bytes);

    return {
      ...base,
      width,
      height,
    };
  }
}
