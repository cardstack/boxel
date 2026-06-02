import { readFirstBytes } from '@cardstack/runtime-common';
import FileAudioIcon from '@cardstack/boxel-icons/file-audio';
import AudioDef from './audio-file-def';
import { type ByteStream, type SerializedFile } from './file-api';
import { extractWavDuration } from './wav-meta-extractor';

// A WAVE file's `fmt ` and `data` chunk headers normally sit within the first
// few hundred bytes, but BWF metadata (bext, LIST/INFO, iXML) can push `data`
// further in. 64 KB matches the JPEG header window and covers anything we'd
// realistically encounter.
const WAV_MAX_HEADER_BYTES = 65_536;

export class WavDef extends AudioDef {
  static displayName = 'WAV Audio';
  static icon = FileAudioIcon;
  static acceptTypes = '.wav,audio/wav,audio/wave,audio/x-wav';

  static async extractAttributes(
    url: string,
    getStream: () => Promise<ByteStream>,
    options: { contentHash?: string } = {},
  ): Promise<SerializedFile<{ duration: number }>> {
    let base = await super.extractAttributes(url, getStream, options);
    let bytes = await readFirstBytes(await getStream(), WAV_MAX_HEADER_BYTES);
    let { duration } = extractWavDuration(bytes);

    return {
      ...base,
      duration,
    };
  }
}
