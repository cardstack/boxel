import FileAudioIcon from '@cardstack/boxel-icons/file-audio';
import AudioDef from './audio-file-def';
import { type ByteStream, type SerializedFile } from './file-api';
import { extractOggDurationFromStream } from './ogg-meta-extractor';

export class OggDef extends AudioDef {
  static displayName = 'OGG Audio';
  static icon = FileAudioIcon;
  static acceptTypes = '.ogg,.oga,.opus,audio/ogg,audio/opus';

  static async extractAttributes(
    url: string,
    getStream: () => Promise<ByteStream>,
    options: { contentHash?: string; contentSize?: number } = {},
  ): Promise<SerializedFile<{ duration: number }>> {
    // OGG duration needs the first page (codec id / sample rate) and the final
    // page's granule position — the head and tail of the file, never the audio
    // payload in between. Stream the container keeping only a small head buffer
    // and a rolling tail window, so even a long recording is parsed with
    // ~64 KB resident rather than the whole file. `super` derives the hash/size
    // from `options` (supplied by the indexer) without re-reading, so when
    // those are present the stream is consumed exactly once — by this walk.
    let base = await super.extractAttributes(url, getStream, options);
    let { duration } = await extractOggDurationFromStream(await getStream());

    return {
      ...base,
      duration,
    };
  }
}
