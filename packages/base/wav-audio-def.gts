import FileAudioIcon from '@cardstack/boxel-icons/file-audio';
import AudioDef, {
  audioAttributes,
  type AudioAttributes,
} from './audio-file-def';
import { FileContentMismatchError } from './file-api';
import type { ByteStream, SerializedFile } from './file-api';
import { WAVEFORM_ALGORITHM, WAVEFORM_BAR_COUNT } from './audio-waveform';
import { extractWavFromStream } from './wav-meta-extractor';

export class WavDef extends AudioDef {
  static displayName = 'WAV Audio';
  static icon = FileAudioIcon;
  static acceptTypes = '.wav,audio/wav,audio/wave,audio/x-wav';

  // Everything comes from one pass over one stream.
  //
  // WAV is the only audio format here that needs no decoder at all: the `data`
  // chunk already holds the samples. The buffered path used to read a header
  // window, then take a second stream, buffer the entire file, and hand it to
  // Web Audio — which allocated a float copy roughly twice the file's size to
  // recover samples the file already contained.
  //
  // Streaming the container instead keeps only a bounded header buffer and one
  // chunk of payload at a time, so memory is flat in the file's duration, and it
  // costs one fetch rather than two. The envelope is true RMS over real samples,
  // so unlike MP3's side-info proxy it needs no normalization and its peak and
  // RMS figures mean what they say.
  static async extractAttributes(
    url: string,
    getStream: () => Promise<ByteStream>,
    options: { contentHash?: string; contentSize?: number } = {},
  ): Promise<SerializedFile<{ duration: number } & AudioAttributes>> {
    let base = await super.extractAttributes(url, getStream, options);
    let result = await extractWavFromStream(
      await getStream(),
      WAVEFORM_BAR_COUNT,
    );

    if (result.duration === undefined) {
      // No `fmt `/`data` pair means this isn't a WAVE container, which is how
      // the extractor knows to fall back to the base FileDef.
      throw new FileContentMismatchError(
        'WAV file is missing a fmt chunk with a non-zero byte rate, or a data chunk',
      );
    }

    return {
      ...base,
      duration: result.duration,
      ...audioAttributes(
        result.encoding,
        result.tags,
        result.envelope
          ? {
              decodeStatus: 'ok',
              algorithm: WAVEFORM_ALGORITHM,
              barsJson: JSON.stringify(result.envelope.bars),
              barCount: result.envelope.bars.length,
              durationSeconds: Math.round(result.duration * 1000) / 1000,
              ...(result.encoding?.sampleRateHz === undefined
                ? {}
                : { sampleRateHz: result.encoding.sampleRateHz }),
              ...(result.encoding?.channels === undefined
                ? {}
                : { channelCount: result.encoding.channels }),
              peakAmplitude: result.envelope.peak,
              rmsAmplitude: result.envelope.rms,
            }
          : {
              decodeStatus: 'failed',
              decodeError: 'No PCM payload to derive an envelope from',
            },
      ),
    };
  }
}

export default WavDef;
