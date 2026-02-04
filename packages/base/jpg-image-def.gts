import { byteStreamToUint8Array } from '@cardstack/runtime-common';
import { ImageDef } from './image-file-def';
import { type ByteStream, type SerializedFile } from './file-api';
import { extractJpgDimensions } from './jpg-meta-extractor';

export class JpgDef extends ImageDef {
  static displayName = 'JPEG Image';

  static async extractAttributes(
    url: string,
    getStream: () => Promise<ByteStream>,
    options: { contentHash?: string } = {},
  ): Promise<SerializedFile<{ width: number; height: number }>> {
    let bytesPromise: Promise<Uint8Array> | undefined;
    let memoizedStream = async () => {
      bytesPromise ??= byteStreamToUint8Array(await getStream());
      return bytesPromise;
    };

    let base = await super.extractAttributes(url, memoizedStream, options);
    let bytes = await memoizedStream();
    let { width, height } = extractJpgDimensions(bytes);

    return {
      ...base,
      width,
      height,
    };
  }
}
