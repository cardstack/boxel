import { readFirstBytes } from '@cardstack/runtime-common';
import { ImageDef } from './image-file-def';
import { type ByteStream, type SerializedFile } from './file-api';
import { extractPngDimensions } from './png-meta-extractor';

export class PngDef extends ImageDef {
  static displayName = 'PNG Image';

  static async extractAttributes(
    url: string,
    getStream: () => Promise<ByteStream>,
    options: { contentHash?: string } = {},
  ): Promise<SerializedFile<{ width: number; height: number }>> {
    let base = await super.extractAttributes(url, getStream, options);
    let bytes = await readFirstBytes(await getStream(), 24);
    let { width, height } = extractPngDimensions(bytes);

    return {
      ...base,
      width,
      height,
    };
  }
}
