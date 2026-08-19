import FileAudioIcon from '@cardstack/boxel-icons/file-audio';
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
    // The same walk hands back the `moov` box, which is all the encoding and tag
    // readers need — so this costs one stream rather than two.
    let { duration, moov } = await extractM4aDurationFromStream(
      await getStream(),
    );

    // Bound before the waveform call so the decode budget can be predicted from
    // the sample rate and channel count the container already stated.
    let encoding = extractM4aEncoding(moov);

    return {
      ...base,
      duration,
      ...audioAttributes(
        encoding,
        extractM4aTags(moov),
        await waveformFor(getStream, {
          durationSeconds: duration,
          sampleRateHz: encoding?.sampleRateHz,
          channels: encoding?.channels,
          contentSize: base.contentSize,
        }),
      ),
    };
  }
}

export default M4aDef;
