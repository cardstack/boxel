import { byteStreamToUint8Array } from '@cardstack/runtime-common';
import FileAudioIcon from '@cardstack/boxel-icons/file-audio';
import AudioDef from './audio-file-def';
import { type ByteStream, type SerializedFile } from './file-api';
import { extractM4aDuration } from './m4a-meta-extractor';

export class M4aDef extends AudioDef {
  static displayName = 'M4A Audio';
  static icon = FileAudioIcon;
  static acceptTypes = '.m4a,audio/mp4,audio/x-m4a';

  static async extractAttributes(
    url: string,
    getStream: () => Promise<ByteStream>,
    options: { contentHash?: string } = {},
  ): Promise<SerializedFile<{ duration: number }>> {
    // M4A files written by iPhone / Apple Voice Memos place `moov` at the
    // end of the file; fast-start optimised files place it near the start.
    // Read the whole stream once so either layout works without seeking.
    let bytesPromise: Promise<Uint8Array> | undefined;
    let memoizedStream = async () => {
      bytesPromise ??= byteStreamToUint8Array(await getStream());
      return bytesPromise;
    };

    let base = await super.extractAttributes(url, memoizedStream, options);
    let bytes = await memoizedStream();
    let { duration } = extractM4aDuration(bytes);

    return {
      ...base,
      duration,
    };
  }
}
