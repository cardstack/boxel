import { readFirstBytes } from '@cardstack/runtime-common';
import FileVideoIcon from '@cardstack/boxel-icons/file-video';
import VideoDef, {
  videoAttributes,
  type VideoAttributes,
} from './video-file-def';
import { FileContentMismatchError } from './file-api';
import type { ByteStream, SerializedFile } from './file-api';
import {
  assertWebmContainer,
  extractWebmEncoding,
} from './webm-meta-extractor';

// Matroska writes Info and Tracks ahead of the Clusters that hold the frames, so
// everything read here is near the front of the file. A megabyte clears the
// SeekHead, Info, Tracks, and any Tags a normal encoder emits without reaching
// the media.
const WEBM_METADATA_WINDOW_BYTES = 1_048_576;

export class WebmDef extends VideoDef {
  static displayName = 'WebM Video';
  static icon = FileVideoIcon;
  static acceptTypes = '.webm,video/webm';

  static async extractAttributes(
    url: string,
    getStream: () => Promise<ByteStream>,
    options: { contentHash?: string; contentSize?: number } = {},
  ): Promise<SerializedFile<VideoAttributes>> {
    let base = await super.extractAttributes(url, getStream, options);
    let bytes = await readFirstBytes(
      await getStream(),
      WEBM_METADATA_WINDOW_BYTES,
    );
    assertWebmContainer(bytes);

    let encoding = extractWebmEncoding(bytes);
    if (!encoding) {
      throw new FileContentMismatchError(
        'WebM file has no readable Segment in the header window',
      );
    }

    return {
      ...base,
      ...videoAttributes(encoding),
    };
  }
}

export default WebmDef;
