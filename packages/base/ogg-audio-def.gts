import FileAudioIcon from '@cardstack/boxel-icons/file-audio';
import { readFirstBytes } from '@cardstack/runtime-common';
import AudioDef, {
  audioAttributes,
  waveformFor,
  type AudioAttributes,
} from './audio-file-def';
import type { ByteStream, SerializedFile } from './file-api';
import {
  extractOggDurationFromStream,
  extractOggEncoding,
  extractOggTags,
} from './ogg-meta-extractor';

// The identification header sits on the first page and the comment block on the
// next one or two, so a 64 KB window reaches both without touching the audio
// payload. Read separately from the duration walk above, which streams and keeps
// no such buffer.
const OGG_METADATA_WINDOW_BYTES = 65_536;

export class OggDef extends AudioDef {
  static displayName = 'OGG Audio';
  static icon = FileAudioIcon;
  static acceptTypes = '.ogg,.oga,.opus,audio/ogg,audio/opus';

  static async extractAttributes(
    url: string,
    getStream: () => Promise<ByteStream>,
    options: { contentHash?: string; contentSize?: number } = {},
  ): Promise<SerializedFile<{ duration: number } & AudioAttributes>> {
    // OGG duration needs the first page (codec id / sample rate) and the final
    // page's granule position — the head and tail of the file, never the audio
    // payload in between. Stream the container keeping only a small head buffer
    // and a rolling tail window, so even a long recording is parsed with
    // ~64 KB resident rather than the whole file. `super` derives the hash/size
    // from `options` (supplied by the indexer) without re-reading, so when
    // those are present the stream is consumed exactly once — by this walk.
    let base = await super.extractAttributes(url, getStream, options);
    let { duration } = await extractOggDurationFromStream(await getStream());

    let header = await readFirstBytes(
      await getStream(),
      OGG_METADATA_WINDOW_BYTES,
    );

    return {
      ...base,
      duration,
      ...audioAttributes(
        extractOggEncoding(header),
        extractOggTags(header),
        await waveformFor(getStream, base.contentSize),
      ),
    };
  }
}
