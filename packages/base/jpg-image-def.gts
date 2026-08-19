import { readFirstBytes } from '@cardstack/runtime-common';
import JpgIcon from '@cardstack/boxel-icons/file-type-jpg';
import {
  RasterImageDef,
  rasterImageAttributes,
  type RasterImageAttributes,
} from './image-file-def';
import type { ByteStream, SerializedFile } from './file-api';
import { extractExifFromJpeg } from './exif-meta-extractor';
import {
  extractJpgColorProfile,
  extractJpgDimensions,
} from './jpg-meta-extractor';

// JPEG SOF marker is typically within the first few KB, but can follow
// large EXIF/ICC segments. 64 KB covers virtually all real-world files.
//
// The same window is what makes EXIF readable: its APP1 segment precedes the
// frame header, so any file whose dimensions this pass can find has already had
// its EXIF stream past.
const JPEG_MAX_HEADER_BYTES = 65_536;

export class JpgDef extends RasterImageDef {
  static displayName = 'JPEG Image';
  static icon = JpgIcon;
  static acceptTypes = '.jpg,.jpeg,image/jpeg';

  static async extractAttributes(
    url: string,
    getStream: () => Promise<ByteStream>,
    options: { contentHash?: string } = {},
  ): Promise<
    SerializedFile<{ width: number; height: number } & RasterImageAttributes>
  > {
    let base = await super.extractAttributes(url, getStream, options);
    let bytes = await readFirstBytes(await getStream(), JPEG_MAX_HEADER_BYTES);
    let { width, height } = extractJpgDimensions(bytes);

    return {
      ...base,
      width,
      height,
      ...rasterImageAttributes(
        extractExifFromJpeg(bytes),
        extractJpgColorProfile(bytes),
      ),
    };
  }
}

export default JpgDef;
