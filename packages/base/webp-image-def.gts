import { byteStreamToUint8Array } from '@cardstack/runtime-common';
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
    let bytesPromise: Promise<Uint8Array> | undefined;
    let memoizedStream = async () => {
      bytesPromise ??= byteStreamToUint8Array(await getStream());
      return bytesPromise;
    };

    let base = await super.extractAttributes(url, memoizedStream, options);
    let bytes = await memoizedStream();
    let { width, height } = extractWebpDimensions(bytes);

    return {
      ...base,
      width,
      height,
    };
  }
}
