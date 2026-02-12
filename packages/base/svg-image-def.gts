import { byteStreamToUint8Array } from '@cardstack/runtime-common';
import { ImageDef } from './image-file-def';
import { type ByteStream, type SerializedFile } from './file-api';
import { extractSvgDimensions } from './svg-meta-extractor';

export class SvgDef extends ImageDef {
  static displayName = 'SVG Image';
  static acceptTypes = '.svg,image/svg+xml';

  static async extractAttributes(
    url: string,
    getStream: () => Promise<ByteStream>,
    options: { contentHash?: string } = {},
  ): Promise<SerializedFile<{ width: number; height: number }>> {
    let base = await super.extractAttributes(url, getStream, options);
    let bytes = await byteStreamToUint8Array(await getStream());
    let { width, height } = extractSvgDimensions(bytes);

    return {
      ...base,
      width,
      height,
    };
  }
}
