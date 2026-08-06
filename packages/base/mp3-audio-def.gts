import { readFirstBytes } from '@cardstack/runtime-common';
import FileAudioIcon from '@cardstack/boxel-icons/file-audio';
import AudioDef, {
  audioAttributes,
  waveformFor,
  type AudioAttributes,
} from './audio-file-def';
import type { ByteStream, SerializedFile } from './file-api';
import {
  extractMp3Duration,
  extractMp3Encoding,
  extractMp3Tags,
} from './mp3-meta-extractor';

// ID3v2 tags can be large (embedded artwork). 1 MB covers virtually all
// real-world files while still bounding worst-case memory at extract time.
const MP3_MAX_HEADER_BYTES = 1_048_576;

export class Mp3Def extends AudioDef {
  static displayName = 'MP3 Audio';
  static icon = FileAudioIcon;
  static acceptTypes = '.mp3,audio/mpeg';

  static async extractAttributes(
    url: string,
    getStream: () => Promise<ByteStream>,
    options: { contentHash?: string; contentSize?: number } = {},
  ): Promise<SerializedFile<{ duration: number } & AudioAttributes>> {
    let base = await super.extractAttributes(url, getStream, options);
    let bytes = await readFirstBytes(await getStream(), MP3_MAX_HEADER_BYTES);
    let { duration } = extractMp3Duration(bytes);

    return {
      ...base,
      duration,
      ...audioAttributes(
        extractMp3Encoding(bytes),
        extractMp3Tags(bytes),
        await waveformFor(getStream, base.contentSize),
      ),
    };
  }
}
