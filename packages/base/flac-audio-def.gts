import { readFirstBytes } from '@cardstack/runtime-common';
import FileAudioIcon from '@cardstack/boxel-icons/file-audio';
import AudioDef, {
  audioAttributes,
  waveformFor,
  type AudioAttributes,
} from './audio-file-def';
import type { ByteStream, SerializedFile } from './file-api';
import {
  FLAC_METADATA_WINDOW_BYTES,
  extractFlacDuration,
  extractFlacEncoding,
  extractFlacTags,
} from './flac-meta-extractor';

// The encoding read needs only STREAMINFO, 42 bytes in — but the tag read needs
// the VORBIS_COMMENT block, which sits behind whatever other metadata blocks the
// encoder wrote. See `FLAC_METADATA_WINDOW_BYTES` for why that is much further.

export class FlacDef extends AudioDef {
  static displayName = 'FLAC Audio';
  static icon = FileAudioIcon;
  static acceptTypes = '.flac,audio/flac,audio/x-flac';

  static async extractAttributes(
    url: string,
    getStream: () => Promise<ByteStream>,
    options: { contentHash?: string; contentSize?: number } = {},
  ): Promise<SerializedFile<{ duration: number } & AudioAttributes>> {
    let base = await super.extractAttributes(url, getStream, options);
    let bytes = await readFirstBytes(
      await getStream(),
      FLAC_METADATA_WINDOW_BYTES,
    );
    let { duration } = extractFlacDuration(bytes);

    return {
      ...base,
      duration,
      ...audioAttributes(
        extractFlacEncoding(bytes),
        extractFlacTags(bytes),
        await waveformFor(getStream, base.contentSize),
      ),
    };
  }
}
