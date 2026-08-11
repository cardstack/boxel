import { readFirstBytes } from '@cardstack/runtime-common';
import FileVideoIcon from '@cardstack/boxel-icons/file-video';
import VideoDef, {
  videoAttributes,
  type VideoAttributes,
} from './video-file-def';
import type { ByteStream, SerializedFile } from './file-api';
import {
  assertMp4Container,
  extractMp4VideoEncoding,
} from './mp4-meta-extractor';

// Everything read here lives in `moov`, whose size is governed by the track
// count and the sample tables rather than by the video's length. The bulk of the
// file is `mdat`, which is never touched.
//
// In a faststart file `moov` precedes `mdat` and sits within this window. In one
// written the other way round it is at the end, past the window, and the file
// indexes with identity only rather than pulling a whole video into memory to
// find it — a deliberate trade, since a long recording can be gigabytes.
const MP4_METADATA_WINDOW_BYTES = 4_194_304;

export class Mp4Def extends VideoDef {
  static displayName = 'MP4 Video';
  static icon = FileVideoIcon;
  static acceptTypes = '.mp4,.m4v,video/mp4';

  protected static containerLabel = 'MP4';

  static async extractAttributes(
    url: string,
    getStream: () => Promise<ByteStream>,
    options: { contentHash?: string; contentSize?: number } = {},
  ): Promise<SerializedFile<VideoAttributes>> {
    let base = await super.extractAttributes(url, getStream, options);
    let bytes = await readFirstBytes(
      await getStream(),
      MP4_METADATA_WINDOW_BYTES,
    );
    // Throws when the file isn't ISO BMFF at all, which is how the extractor
    // knows to fall back to the base FileDef.
    assertMp4Container(bytes);

    // No `moov` in the window (a non-faststart file keeps it at the end)
    // yields no encoding; the file keeps its MP4 type with identity only.
    let encoding = extractMp4VideoEncoding(bytes, this.containerLabel);

    return {
      ...base,
      ...videoAttributes(encoding),
    };
  }
}

export default Mp4Def;
