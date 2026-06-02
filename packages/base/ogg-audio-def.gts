import { byteStreamToUint8Array } from '@cardstack/runtime-common';
import FileAudioIcon from '@cardstack/boxel-icons/file-audio';
import AudioDef from './audio-file-def';
import { type ByteStream, type SerializedFile } from './file-api';
import { extractOggDuration } from './ogg-meta-extractor';

export class OggDef extends AudioDef {
  static displayName = 'OGG Audio';
  static icon = FileAudioIcon;
  static acceptTypes = '.ogg,.oga,.opus,audio/ogg,audio/opus';

  static async extractAttributes(
    url: string,
    getStream: () => Promise<ByteStream>,
    options: { contentHash?: string } = {},
  ): Promise<SerializedFile<{ duration: number }>> {
    // OGG duration requires the final page's granule position, which lives
    // at the tail of the file. Read the whole stream once and reuse the
    // bytes for both base attribute extraction and duration parsing.
    let bytesPromise: Promise<Uint8Array> | undefined;
    let memoizedStream = async () => {
      bytesPromise ??= byteStreamToUint8Array(await getStream());
      return bytesPromise;
    };

    let base = await super.extractAttributes(url, memoizedStream, options);
    let bytes = await memoizedStream();
    let { duration } = extractOggDuration(bytes);

    return {
      ...base,
      duration,
    };
  }
}
