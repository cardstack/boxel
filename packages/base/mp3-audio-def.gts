import { readFirstBytes } from '@cardstack/runtime-common';
import FileAudioIcon from '@cardstack/boxel-icons/file-audio';
import AudioDef, {
  audioAttributes,
  type AudioAttributes,
} from './audio-file-def';
import type { ByteStream, SerializedFile } from './file-api';
import {
  extractMp3Duration,
  extractMp3Encoding,
  extractMp3EnvelopeFromStream,
  extractMp3Tags,
} from './mp3-meta-extractor';
import {
  WAVEFORM_ALGORITHM_SIDE_INFO,
  WAVEFORM_BAR_COUNT,
} from './audio-waveform';
import type { WaveformMetadata } from './audio-waveform';

// ID3v2 tags can be large (embedded artwork). 1 MB covers virtually all
// real-world files while still bounding worst-case memory at extract time.
const MP3_MAX_HEADER_BYTES = 1_048_576;

export class Mp3Def extends AudioDef {
  static displayName = 'MP3 Audio';
  static icon = FileAudioIcon;
  static acceptTypes = '.mp3,audio/mpeg';

  static async extractAttributes(
    url: string,
    getStream: () => Promise<ByteStream>,
    options: { contentHash?: string; contentSize?: number } = {},
  ): Promise<SerializedFile<{ duration: number } & AudioAttributes>> {
    let base = await super.extractAttributes(url, getStream, options);
    let bytes = await readFirstBytes(await getStream(), MP3_MAX_HEADER_BYTES);
    let { duration } = extractMp3Duration(bytes);

    return {
      ...base,
      duration,
      ...audioAttributes(
        extractMp3Encoding(bytes),
        extractMp3Tags(bytes),
        await this.readWaveform(getStream),
      ),
    };
  }

  // MP3 never needs a decoder for its envelope. Every frame's side info states
  // a quantizer gain per granule, which is an amplitude scale readable by
  // walking frame headers — and because frames are self-delimiting, the walk
  // streams: it keeps a rolling buffer of a few frames and discards what it has
  // passed, so neither decoded audio nor the encoded file is ever fully
  // resident.
  //
  // That matters most here: float PCM costs roughly twenty times the encoded
  // size for a 128 kbps stream, making MP3 the worst case for a full decode by a
  // wide margin. This path is flat in memory regardless of duration, so it runs
  // with no size ceiling at all.
  //
  // Falling back to a real decode when the side-info walk finds nothing would
  // reintroduce exactly the cost this avoids, so a file that yields no frames
  // reports the failure instead.
  private static async readWaveform(
    getStream: () => Promise<ByteStream>,
  ): Promise<WaveformMetadata> {
    try {
      let envelope = await extractMp3EnvelopeFromStream(
        await getStream(),
        WAVEFORM_BAR_COUNT,
      );
      if (!envelope) {
        return {
          decodeStatus: 'failed',
          decodeError: 'No readable MPEG frames to derive an envelope from',
        };
      }
      return {
        decodeStatus: 'ok',
        algorithm: WAVEFORM_ALGORITHM_SIDE_INFO,
        barsJson: JSON.stringify(envelope.bars),
        barCount: envelope.bars.length,
        ...(envelope.durationSeconds === undefined
          ? {}
          : { durationSeconds: envelope.durationSeconds }),
        ...(envelope.sampleRateHz === undefined
          ? {}
          : { sampleRateHz: envelope.sampleRateHz }),
        // A quantizer scale carries no calibrated amplitude, so the envelope is
        // normalized to the track's own peak and the absolute figures are left
        // unset rather than reported on a scale that isn't comparable with a
        // decoded one.
      };
    } catch (error) {
      return {
        decodeStatus: 'failed',
        decodeError:
          error instanceof Error
            ? error.message
            : `Could not read audio bytes: ${String(error)}`,
      };
    }
  }
}
