import { readFirstBytes } from '@cardstack/runtime-common';
import { ImageDef } from './image-file-def';
import { type ByteStream, type SerializedFile } from './file-api';
import { extractJpgDimensions } from './jpg-meta-extractor';

// JPEG SOF marker is typically within the first few KB, but can follow
// large EXIF/ICC segments. 64 KB covers virtually all real-world files.
const JPEG_MAX_HEADER_BYTES = 65_536;

export class JpgDef extends ImageDef {
  static displayName = 'JPEG Image';

  static async extractAttributes(
    url: string,
    getStream: () => Promise<ByteStream>,
    options: { contentHash?: string } = {},
  ): Promise<SerializedFile<{ width: number; height: number }>> {
    let base = await super.extractAttributes(url, getStream, options);
    let bytes = await readFirstBytes(await getStream(), JPEG_MAX_HEADER_BYTES);
    let { width, height } = extractJpgDimensions(bytes);

    return {
      ...base,
      width,
      height,
    };
  }
}
