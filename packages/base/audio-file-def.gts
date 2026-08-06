import MusicIcon from '@cardstack/boxel-icons/music';
import {
  BaseDefComponent,
  Component,
  NumberField,
  contains,
  field,
} from './card-api';
import { byteStreamToUint8Array } from '@cardstack/runtime-common';
import { FileDef } from './file-api';
import {
  MediaEncodingField,
  MediaTagsField,
  WaveformMetadataField,
} from './file-formats/metadata-fields';
import { markdownAudio } from './markdown-helpers';
import {
  WAVEFORM_MAX_ENCODED_BYTES,
  extractAudioWaveform,
} from './audio-waveform';
import type { AudioEncoding, MediaTags } from './audio-metadata';
import type { WaveformMetadata } from './audio-waveform';
import type { ByteStream } from './file-api';
import AudioDefIsolatedTemplate from './default-templates/audio-def-isolated';
import AudioDefEmbeddedTemplate from './default-templates/audio-def-embedded';
import AudioDefFittedTemplate from './default-templates/audio-def-fitted';
import AudioDefAtomTemplate from './default-templates/audio-def-atom';

export class AudioDef extends FileDef {
  static displayName = 'Audio';
  static icon = MusicIcon;
  static acceptTypes = 'audio/*';

  @field duration = contains(NumberField);

  // How the stream is encoded, read from the container's own header.
  @field encoding = contains(MediaEncodingField);

  // What the track says about itself. Empty for anything untagged, which is most
  // audio that wasn't ripped or published.
  @field tags = contains(MediaTagsField);

  // The decoded amplitude envelope. Unlike every other field here this requires
  // a real decoder rather than a header read, so it carries its own status and
  // is the one audio fact that can legitimately be missing. MIDI deliberately
  // does not inherit it — a note sequence has no amplitude until something
  // synthesizes it.
  @field waveform = contains(WaveformMetadataField);

  static isolated: BaseDefComponent = AudioDefIsolatedTemplate;
  static embedded: BaseDefComponent = AudioDefEmbeddedTemplate;
  static fitted: BaseDefComponent = AudioDefFittedTemplate;
  static atom: BaseDefComponent = AudioDefAtomTemplate;

  // Markdown has no native audio syntax, but CommonMark passes raw HTML
  // through, so we emit an inline `<audio controls>` so the Spec preview,
  // docs, and downstream consumers render a real player rather than a bare
  // link — matching what ImageDef does for `<img>`.
  static markdown: BaseDefComponent = class Markdown extends Component<
    typeof AudioDef
  > {
    get text() {
      let model = this.args.model;
      if (!model) {
        return '';
      }
      let url = model.url ?? model.sourceUrl ?? '';
      let name = model.name ?? '';
      if (!url && !name) {
        return '';
      }
      return markdownAudio(name, url);
    }
    <template>{{this.text}}</template>
  };
}

export default AudioDef;

// A `CodedValueField` as it arrives over the wire.
interface SerializedCodedValue {
  code: string;
  scheme: string;
}

// A `QuantityField` as it arrives over the wire.
interface SerializedQuantity {
  value: number;
  unit?: string;
  displayText?: string;
}

// `MediaEncodingField`'s wire shape. It differs from `AudioEncoding` in that a
// rate travels as a Quantity and a channel mode as a CodedValue, so the per-format
// readers stay free of any knowledge about how the fields are modeled.
export interface SerializedMediaEncoding {
  container?: string;
  audioCodec?: string;
  sampleRate?: SerializedQuantity;
  bitrate?: SerializedQuantity;
  bitDepth?: number;
  channels?: number;
  channelMode?: SerializedCodedValue;
  isVariableBitrate?: boolean;
}

// `MediaTagsField`'s wire shape: as `MediaTags`, but with the scheme wrapped.
export type SerializedMediaTags = Omit<MediaTags, 'scheme'> & {
  scheme?: SerializedCodedValue;
};

// The attributes a sampled-audio subclass's `extractAttributes` adds on top of
// the base file identity and duration.
export interface AudioAttributes {
  encoding?: SerializedMediaEncoding;
  tags?: SerializedMediaTags;
  waveform?: WaveformMetadata;
}

// Bitrates read in the thousands and sample rates in the tens of thousands, so
// both get a unit and let QuantityField's own formatting add the separators.
function kilo(value: number | undefined, unit: string) {
  return value === undefined ? undefined : { value, unit };
}

// Assemble the audio metadata attributes from whatever a format's readers could
// determine, omitting each one entirely when they determined nothing — an
// untagged file should add no `tags` attribute rather than an empty object.
export function audioAttributes(
  encoding: AudioEncoding | undefined,
  tags: MediaTags | undefined,
  waveform?: WaveformMetadata,
): AudioAttributes {
  let serializedEncoding: SerializedMediaEncoding | undefined;
  if (encoding) {
    let { sampleRateHz, bitrateBps, channelMode, ...rest } = encoding;
    serializedEncoding = {
      ...rest,
      ...(sampleRateHz === undefined
        ? {}
        : { sampleRate: kilo(sampleRateHz, 'Hz') }),
      ...(bitrateBps === undefined
        ? {}
        : { bitrate: kilo(bitrateBps, 'bps') }),
      ...(channelMode === undefined
        ? {}
        : { channelMode: { code: channelMode, scheme: 'channel-mode' } }),
    };
  }

  let serializedTags: SerializedMediaTags | undefined;
  if (tags) {
    let { scheme, ...rest } = tags;
    serializedTags = {
      ...rest,
      ...(scheme === undefined
        ? {}
        : { scheme: { code: scheme, scheme: 'tag-scheme' } }),
    };
  }

  return {
    ...(serializedEncoding ? { encoding: serializedEncoding } : {}),
    ...(serializedTags ? { tags: serializedTags } : {}),
    // A skipped or failed decode is still worth persisting: it's the difference
    // between "no waveform yet" and "this file cannot produce one".
    ...(waveform ? { waveform } : {}),
  };
}

// Produce a waveform, or an honest reason for not having one.
//
// This is the one audio fact that needs the whole file rather than a header
// window, so it asks for a second stream — which the extract runner satisfies by
// re-fetching and buffering. That is a real cost during indexing, so the size
// check comes first and uses `contentSize` when the indexer supplied it: a file
// over the ceiling never triggers the extra read at all, rather than being
// fetched and then rejected.
export async function waveformFor(
  getStream: () => Promise<ByteStream>,
  contentSize: number | undefined,
): Promise<WaveformMetadata> {
  if (
    contentSize !== undefined &&
    contentSize > WAVEFORM_MAX_ENCODED_BYTES
  ) {
    return {
      decodeStatus: 'skipped',
      decodeError: `File exceeds the ${Math.floor(
        WAVEFORM_MAX_ENCODED_BYTES / (1024 * 1024),
      )} MB decode ceiling`,
    };
  }
  try {
    let bytes = await byteStreamToUint8Array(await getStream());
    return await extractAudioWaveform(bytes);
  } catch (error) {
    // A stream that won't re-read is not a reason to fail the whole extract; the
    // header-derived facts are already gathered.
    return {
      decodeStatus: 'failed',
      decodeError:
        error instanceof Error
          ? error.message
          : `Could not read audio bytes: ${String(error)}`,
    };
  }
}
