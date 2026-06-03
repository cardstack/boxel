import { readFirstBytes } from '@cardstack/runtime-common';
import FileAudioIcon from '@cardstack/boxel-icons/file-audio';
import AudioDef from './audio-file-def';
import { type ByteStream, type SerializedFile } from './file-api';
import { extractFlacDuration } from './flac-meta-extractor';

// "fLaC" marker (4) + STREAMINFO block header (4) + STREAMINFO data (34) = 42.
// Round up to leave room for stream-chunking artefacts.
const FLAC_MAX_HEADER_BYTES = 256;

export class FlacDef extends AudioDef {
  static displayName = 'FLAC Audio';
  static icon = FileAudioIcon;
  static acceptTypes = '.flac,audio/flac,audio/x-flac';

  static async extractAttributes(
    url: string,
    getStream: () => Promise<ByteStream>,
    options: { contentHash?: string } = {},
  ): Promise<SerializedFile<{ duration: number }>> {
    let base = await super.extractAttributes(url, getStream, options);
    let bytes = await readFirstBytes(await getStream(), FLAC_MAX_HEADER_BYTES);
    let { duration } = extractFlacDuration(bytes);

    return {
      ...base,
      duration,
    };
  }
}
