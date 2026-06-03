import FileAudioIcon from '@cardstack/boxel-icons/file-audio';
import AudioDef from './audio-file-def';
import type { ByteStream, SerializedFile } from './file-api';
import { extractM4aDurationFromStream } from './m4a-meta-extractor';

export class M4aDef extends AudioDef {
  static displayName = 'M4A Audio';
  static icon = FileAudioIcon;
  static acceptTypes = '.m4a,audio/mp4,audio/x-m4a';

  static async extractAttributes(
    url: string,
    getStream: () => Promise<ByteStream>,
    options: { contentHash?: string; contentSize?: number } = {},
  ): Promise<SerializedFile<{ duration: number }>> {
    // Duration lives in the small `moov` box; the bulk of an M4A file is the
    // `mdat` media payload, which we never need. Walk the container off the
    // stream, retaining only `moov` and discarding `mdat`, so even a long
    // recording is parsed with a few KB resident rather than the whole file.
    // `super` derives the hash/size from `options` (supplied by the indexer)
    // without re-reading, so when those are present the stream is consumed
    // exactly once — by this walk.
    let base = await super.extractAttributes(url, getStream, options);
    let { duration } = await extractM4aDurationFromStream(await getStream());

    return {
      ...base,
      duration,
    };
  }
}
