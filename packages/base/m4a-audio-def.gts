import FileAudioIcon from '@cardstack/boxel-icons/file-audio';
import { readFirstBytes } from '@cardstack/runtime-common';
import AudioDef, {
  audioAttributes,
  waveformFor,
  type AudioAttributes,
} from './audio-file-def';
import type { ByteStream, SerializedFile } from './file-api';
import {
  extractM4aDurationFromStream,
  extractM4aEncoding,
  extractM4aTags,
} from './m4a-meta-extractor';

// `moov` holds both the sample entry and the iTunes atoms, and in a
// faststart-arranged file it precedes `mdat`. 256 KB covers a typical `moov`
// including cover art. A file that interleaves `moov` after a large `mdat` simply
// yields no metadata here rather than pulling the whole payload into memory.
const M4A_METADATA_WINDOW_BYTES = 262_144;

export class M4aDef extends AudioDef {
  static displayName = 'M4A Audio';
  static icon = FileAudioIcon;
  static acceptTypes = '.m4a,audio/mp4,audio/x-m4a';

  static async extractAttributes(
    url: string,
    getStream: () => Promise<ByteStream>,
    options: { contentHash?: string; contentSize?: number } = {},
  ): Promise<SerializedFile<{ duration: number } & AudioAttributes>> {
    // Duration lives in the small `moov` box; the bulk of an M4A file is the
    // `mdat` media payload, which we never need. Walk the container off the
    // stream, retaining only `moov` and discarding `mdat`, so even a long
    // recording is parsed with a few KB resident rather than the whole file.
    // `super` derives the hash/size from `options` (supplied by the indexer)
    // without re-reading, so when those are present the stream is consumed
    // exactly once — by this walk.
    let base = await super.extractAttributes(url, getStream, options);
    let { duration } = await extractM4aDurationFromStream(await getStream());

    let header = await readFirstBytes(
      await getStream(),
      M4A_METADATA_WINDOW_BYTES,
    );

    return {
      ...base,
      duration,
      ...audioAttributes(
        extractM4aEncoding(header),
        extractM4aTags(header),
        await waveformFor(getStream, base.contentSize),
      ),
    };
  }
}
