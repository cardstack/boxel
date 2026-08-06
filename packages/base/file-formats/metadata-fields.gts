// Shared metadata FieldDefs: one shape per metadata *family*, reused by every
// file type that carries it. A GPS block reads identically on a photo and on a
// video; a camera block is the same shape whether the bytes came from a JPEG's
// EXIF IFD or a HEIF item property. Keeping the shape shared — rather than
// giving each extension its own flat spray of columns — is what lets a query
// or a renderer treat "where was this captured" as one question.
//
// Every value here is written by an extractor during the index pass and is an
// ordinary persisted field, so it stays inspectable and correctable through
// Boxel's generated editor. Nothing in this module parses bytes; see the
// `*-meta-extractor` modules for that.
//
// These fields deliberately live outside `card-api`'s import graph. `card-api`
// statically imports FileDef's format templates, so anything those reach lands
// in the deps of every card in every realm. A family attaches its metadata on
// its own subclass module instead, so only realms holding that file type pay.

import AudioWaveformIcon from '@cardstack/boxel-icons/audio-waveform';
import CameraIcon from '@cardstack/boxel-icons/camera';
import FileAudioIcon from '@cardstack/boxel-icons/file-audio';
import MapPinIcon from '@cardstack/boxel-icons/map-pin';
import PaletteIcon from '@cardstack/boxel-icons/palette';
import RulerIcon from '@cardstack/boxel-icons/ruler';
import TagIcon from '@cardstack/boxel-icons/tag';
import TagsIcon from '@cardstack/boxel-icons/tags';

import FileInfoIcon from '@cardstack/boxel-icons/file-info';

import {
  Component,
  FieldDef,
  NumberField,
  StringField,
  TextAreaField,
  contains,
  field,
} from '../card-api';
import BooleanField from '../boolean';
import DateTimeField from '../datetime';

// Coded values keep the file's own number — a `flash` of 25 stays 25 — while
// still reading as English. Persisting the label instead would throw away the
// only thing that survives a vocabulary correction, and persisting the code
// alone would make every consumer re-implement the lookup.
export const METADATA_VOCABULARIES: Record<
  string,
  Record<string, string>
> = Object.freeze({
  'exif-orientation': {
    '1': 'Normal',
    '2': 'Mirror horizontal',
    '3': 'Rotate 180',
    '4': 'Mirror vertical',
    '5': 'Mirror + rotate 270',
    '6': 'Rotate 90 CW',
    '7': 'Mirror + rotate 90',
    '8': 'Rotate 270 CW',
  },
  'exif-flash': {
    '0': 'No flash',
    '1': 'Fired',
    '5': 'Fired, no return',
    '7': 'Fired, return detected',
    '16': 'Off, did not fire',
    '24': 'Auto, did not fire',
    '25': 'Auto, fired',
  },
  'geo-source': {
    'exif-gps': 'EXIF GPS IFD',
    'ios-photos': 'iOS Photos convention',
    'android-photos': 'Android Photos convention',
  },
  // Which tagging convention the track's descriptive metadata came from. Worth
  // recording because the schemes disagree about what a field means — an ID3v2
  // `TRCK` is "4/12" while an MP4 `trkn` atom is a pair of integers — so a
  // consumer comparing two files needs to know which it is reading.
  'tag-scheme': {
    id3v2: 'ID3v2',
    'riff-info': 'RIFF LIST-INFO',
    'mp4-atoms': 'MP4 metadata atoms',
    'vorbis-comment': 'Vorbis comment',
    xmp: 'XMP',
  },
  'channel-mode': {
    mono: 'Mono',
    stereo: 'Stereo',
    'joint-stereo': 'Joint stereo',
    'dual-mono': 'Dual mono',
    surround: 'Surround',
  },
  'color-space': {
    srgb: 'sRGB',
    'display-p3': 'Display P3',
    'adobe-rgb': 'Adobe RGB',
    rec2020: 'Rec. 2020',
    grayscale: 'Grayscale',
    'grayscale-alpha': 'Grayscale + alpha',
    indexed: 'Indexed color',
    ycbcr: 'YCbCr',
    cmyk: 'CMYK',
    uncalibrated: 'Uncalibrated',
  },
});

// An unrecognized code renders as itself rather than disappearing: a file
// carrying a vendor extension we don't have a word for is still evidence.
export function labelForCode(scheme?: string, code?: string): string {
  if (!scheme || code === undefined || code === null || code === '') {
    return '';
  }
  return METADATA_VOCABULARIES[scheme]?.[String(code)] ?? String(code);
}

// A measured number and the unit it was measured in. Extractors that can
// produce a better human string than a bare number/unit join — a shutter speed
// is conventionally "1/250 s", not "0.004 s" — supply `displayText`, and it
// wins.
export class QuantityField extends FieldDef {
  static displayName = 'Quantity';
  static icon = RulerIcon;

  @field value = contains(NumberField);
  @field unit = contains(StringField);
  @field displayText = contains(StringField);

  @field display = contains(StringField, {
    computeVia: function (this: QuantityField) {
      if (this.displayText) {
        return this.displayText;
      }
      if (this.value == null) {
        return '';
      }
      // Thousands separators help at scale (a 48000 Hz sample rate); below
      // that, trailing float noise hurts more than precision helps, so round
      // to three decimals.
      let magnitude =
        Math.abs(this.value) >= 1000
          ? this.value.toLocaleString()
          : String(Math.round(this.value * 1000) / 1000);
      return this.unit ? `${magnitude} ${this.unit}` : magnitude;
    },
  });

  static embedded = class Embedded extends Component<typeof QuantityField> {
    <template>
      <span class='quantity'>{{@model.display}}</span>
      <style scoped>
        .quantity {
          font-variant-numeric: tabular-nums;
        }
      </style>
    </template>
  };

  static atom = this.embedded;
}

// A value the format defines as an enumerated code, paired with the vocabulary
// that names it.
export class CodedValueField extends FieldDef {
  static displayName = 'Coded Value';
  static icon = TagIcon;

  @field code = contains(StringField);
  @field scheme = contains(StringField);

  @field label = contains(StringField, {
    computeVia: function (this: CodedValueField) {
      return labelForCode(this.scheme, this.code);
    },
  });

  static embedded = class Embedded extends Component<typeof CodedValueField> {
    <template>
      {{#if @model.label}}
        <span
          class='coded-value'
          title='{{@model.scheme}} · code {{@model.code}}'
        >{{@model.label}}</span>
      {{/if}}
      <style scoped>
        .coded-value {
          border-bottom: 0.0625rem dotted var(--muted-foreground);
          cursor: help;
        }
      </style>
    </template>
  };

  static atom = this.embedded;
}

// How the frame was taken. Shared by stills and video: a camera is a camera.
export class CameraCaptureField extends FieldDef {
  static displayName = 'Camera Capture';
  static icon = CameraIcon;

  @field make = contains(StringField);
  // Not `model`: a field named `model` would collide with the `@model` a
  // template receives, making every reference in this file ambiguous to read.
  @field cameraModel = contains(StringField);
  @field lensModel = contains(StringField);
  @field focalLength = contains(QuantityField);
  @field aperture = contains(QuantityField);
  @field exposureTime = contains(QuantityField);
  @field iso = contains(NumberField);
  @field flash = contains(CodedValueField);
  @field orientation = contains(CodedValueField);
  @field capturedAt = contains(DateTimeField);
  @field software = contains(StringField);

  @field cameraName = contains(StringField, {
    computeVia: function (this: CameraCaptureField) {
      // Makers vary on whether the model string already carries the make
      // ("Canon EOS R5" vs. a bare "X-T4"), so only prepend when it doesn't.
      let make = this.make?.trim() ?? '';
      let cameraModel = this.cameraModel?.trim() ?? '';
      if (!cameraModel) {
        return make;
      }
      if (!make || cameraModel.toLowerCase().startsWith(make.toLowerCase())) {
        return cameraModel;
      }
      return `${make} ${cameraModel}`;
    },
  });

  static embedded = class Embedded extends Component<typeof CameraCaptureField> {
    <template>
      <dl class='metadata-rows'>
        {{#if @model.cameraName}}
          <div class='row'><dt>Camera</dt><dd>{{@model.cameraName}}</dd></div>
        {{/if}}
        {{#if @model.lensModel}}
          <div class='row'><dt>Lens</dt><dd>{{@model.lensModel}}</dd></div>
        {{/if}}
        {{#if @model.focalLength.display}}
          <div class='row'><dt>Focal length</dt><dd><@fields.focalLength
              /></dd></div>
        {{/if}}
        {{#if @model.aperture.display}}
          <div class='row'><dt>Aperture</dt><dd><@fields.aperture /></dd></div>
        {{/if}}
        {{#if @model.exposureTime.display}}
          <div class='row'><dt>Exposure</dt><dd><@fields.exposureTime
              /></dd></div>
        {{/if}}
        {{#if @model.iso}}
          <div class='row'><dt>ISO</dt><dd>{{@model.iso}}</dd></div>
        {{/if}}
        {{#if @model.flash.label}}
          <div class='row'><dt>Flash</dt><dd><@fields.flash /></dd></div>
        {{/if}}
        {{#if @model.orientation.label}}
          <div class='row'><dt>Orientation</dt><dd><@fields.orientation
              /></dd></div>
        {{/if}}
        {{#if @model.software}}
          <div class='row'><dt>Software</dt><dd>{{@model.software}}</dd></div>
        {{/if}}
      </dl>
      <style scoped>
        .metadata-rows {
          margin: 0;
          display: flex;
          flex-direction: column;
          gap: 0.3125rem;
          font-size: 0.75rem;
        }
        .row {
          display: flex;
          gap: 0.625rem;
          align-items: baseline;
        }
        dt {
          flex: 0 0 5.75rem;
          font-family: var(--font-mono);
          font-size: 0.5625rem;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          color: var(--muted-foreground);
        }
        dd {
          margin: 0;
          min-width: 0;
        }
      </style>
    </template>
  };
}

// Where the file was made. `latitude`/`longitude` stay plain numbers so they
// remain range-queryable; the formatted forms are computed.
export class GeoLocationField extends FieldDef {
  static displayName = 'Geo Location';
  static icon = MapPinIcon;

  @field latitude = contains(NumberField);
  @field longitude = contains(NumberField);
  @field altitude = contains(QuantityField);
  @field placeName = contains(StringField);
  @field city = contains(StringField);
  @field region = contains(StringField);
  @field country = contains(StringField);
  @field source = contains(CodedValueField);

  @field coordinates = contains(StringField, {
    computeVia: function (this: GeoLocationField) {
      if (this.latitude == null || this.longitude == null) {
        return '';
      }
      let latitude = `${Math.abs(this.latitude).toFixed(4)}° ${
        this.latitude >= 0 ? 'N' : 'S'
      }`;
      let longitude = `${Math.abs(this.longitude).toFixed(4)}° ${
        this.longitude >= 0 ? 'E' : 'W'
      }`;
      return `${latitude}, ${longitude}`;
    },
  });

  @field place = contains(StringField, {
    computeVia: function (this: GeoLocationField) {
      return [this.placeName, this.city, this.region, this.country]
        .filter(Boolean)
        .join(' · ');
    },
  });

  static embedded = class Embedded extends Component<typeof GeoLocationField> {
    <template>
      <dl class='metadata-rows'>
        {{#if @model.coordinates}}
          <div class='row'><dt>Coordinates</dt><dd
              class='mono'
            >{{@model.coordinates}}</dd></div>
        {{/if}}
        {{#if @model.altitude.display}}
          <div class='row'><dt>Altitude</dt><dd><@fields.altitude /></dd></div>
        {{/if}}
        {{#if @model.place}}
          <div class='row'><dt>Place</dt><dd>{{@model.place}}</dd></div>
        {{/if}}
        {{#if @model.source.label}}
          <div class='row'><dt>Source</dt><dd><@fields.source /></dd></div>
        {{/if}}
      </dl>
      <style scoped>
        .metadata-rows {
          margin: 0;
          display: flex;
          flex-direction: column;
          gap: 0.3125rem;
          font-size: 0.75rem;
        }
        .row {
          display: flex;
          gap: 0.625rem;
          align-items: baseline;
        }
        dt {
          flex: 0 0 5.75rem;
          font-family: var(--font-mono);
          font-size: 0.5625rem;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          color: var(--muted-foreground);
        }
        dd {
          margin: 0;
          min-width: 0;
        }
        .mono {
          font-family: var(--font-mono);
          font-size: 0.6875rem;
        }
      </style>
    </template>
  };
}

// How the pixels are encoded. `hasAlpha` is nullable on purpose: "this format
// has no alpha channel" and "we couldn't tell" are different answers, and a
// default of `false` would launder the second into the first.
export class ColorProfileField extends FieldDef {
  static displayName = 'Color Profile';
  static icon = PaletteIcon;

  @field colorSpace = contains(CodedValueField);
  @field bitDepth = contains(NumberField);
  @field channels = contains(NumberField);
  @field hasAlpha = contains(BooleanField);
  @field iccProfile = contains(StringField);

  // A plain `{{#if @model.hasAlpha}}` would hide a genuine `false` alongside an
  // unset value, collapsing the "no alpha channel" fact this field is careful to
  // record. Projecting to a non-empty string keeps the two distinguishable in
  // the template while still rendering nothing when we never learned either way.
  @field hasAlphaLabel = contains(StringField, {
    computeVia: function (this: ColorProfileField) {
      if (this.hasAlpha == null) {
        return '';
      }
      return this.hasAlpha ? 'Yes' : 'No';
    },
  });

  static embedded = class Embedded extends Component<typeof ColorProfileField> {
    <template>
      <dl class='metadata-rows'>
        {{#if @model.colorSpace.label}}
          <div class='row'><dt>Color space</dt><dd><@fields.colorSpace
              /></dd></div>
        {{/if}}
        {{#if @model.bitDepth}}
          <div class='row'><dt>Bit depth</dt><dd>{{@model.bitDepth}}-bit</dd></div>
        {{/if}}
        {{#if @model.channels}}
          <div class='row'><dt>Channels</dt><dd>{{@model.channels}}</dd></div>
        {{/if}}
        {{#if @model.hasAlphaLabel}}
          <div class='row'><dt>Alpha</dt><dd>{{@model.hasAlphaLabel}}</dd></div>
        {{/if}}
        {{#if @model.iccProfile}}
          <div class='row'><dt>ICC profile</dt><dd>{{@model.iccProfile}}</dd></div>
        {{/if}}
      </dl>
      <style scoped>
        .metadata-rows {
          margin: 0;
          display: flex;
          flex-direction: column;
          gap: 0.3125rem;
          font-size: 0.75rem;
        }
        .row {
          display: flex;
          gap: 0.625rem;
          align-items: baseline;
        }
        dt {
          flex: 0 0 5.75rem;
          font-family: var(--font-mono);
          font-size: 0.5625rem;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          color: var(--muted-foreground);
        }
        dd {
          margin: 0;
          min-width: 0;
        }
      </style>
    </template>
  };
}

// What the camera recorded about the moment, grouped so a family declares one
// field rather than two and a consumer has one place to look.
//
// Color is deliberately *not* here. EXIF's `ColorSpace` tag is one weak signal
// about the pixels, while the container's own header states bit depth, channel
// count, and alpha outright. Keeping both would mean two `colorProfile` blocks
// disagreeing about the same file, so the container wins and the family carries
// a single `ColorProfileField` alongside this one — with the EXIF tag folded in
// as a fallback for color space alone.
export class ExifMetadataField extends FieldDef {
  static displayName = 'EXIF Metadata';
  static icon = FileInfoIcon;

  @field capture = contains(CameraCaptureField);
  @field location = contains(GeoLocationField);

  static embedded = class Embedded extends Component<typeof ExifMetadataField> {
    <template>
      <section class='exif'>
        <@fields.capture />
        <@fields.location />
      </section>
      <style scoped>
        .exif {
          display: grid;
          gap: 0.75rem;
        }
      </style>
    </template>
  };
}

// How a media stream is encoded. Shared by sampled audio and, as that family
// lands, video — a sample rate means the same thing in an MP3 and in an MP4's
// audio track, so asking "what was this encoded at" shouldn't depend on the
// container.
//
// Fields a given container cannot state are left unset. FLAC declares its bit
// depth outright; MP3 has no such concept, and reporting a plausible 16 would
// invent a fact the file never carried.
export class MediaEncodingField extends FieldDef {
  static displayName = 'Media Encoding';
  static icon = FileAudioIcon;

  @field container = contains(StringField);
  @field audioCodec = contains(StringField);
  @field sampleRate = contains(QuantityField);
  @field bitrate = contains(QuantityField);
  @field bitDepth = contains(NumberField);
  @field channels = contains(NumberField);
  @field channelMode = contains(CodedValueField);
  // Whether the bitrate figure describes the whole stream or one frame of it.
  // A VBR file's per-frame bitrate says almost nothing about the file, so a
  // consumer comparing two numbers needs to know which kind it has.
  @field isVariableBitrate = contains(BooleanField);

  static embedded = class Embedded extends Component<
    typeof MediaEncodingField
  > {
    <template>
      <dl class='metadata-rows'>
        {{#if @model.container}}
          <div class='row'><dt>Container</dt><dd
              class='mono'
            >{{@model.container}}</dd></div>
        {{/if}}
        {{#if @model.audioCodec}}
          <div class='row'><dt>Codec</dt><dd class='mono'>{{@model.audioCodec}}</dd></div>
        {{/if}}
        {{#if @model.sampleRate.display}}
          <div class='row'><dt>Sample rate</dt><dd><@fields.sampleRate
              /></dd></div>
        {{/if}}
        {{#if @model.bitrate.display}}
          <div class='row'><dt>Bitrate</dt><dd><@fields.bitrate />{{#if
                @model.isVariableBitrate
              }}<span class='qualifier'>VBR</span>{{/if}}</dd></div>
        {{/if}}
        {{#if @model.bitDepth}}
          <div class='row'><dt>Bit depth</dt><dd>{{@model.bitDepth}}-bit</dd></div>
        {{/if}}
        {{#if @model.channels}}
          <div class='row'><dt>Channels</dt><dd>{{@model.channels}}{{#if
                @model.channelMode.label
              }}<span class='qualifier'><@fields.channelMode
                /></span>{{/if}}</dd></div>
        {{/if}}
      </dl>
      <style scoped>
        .metadata-rows {
          margin: 0;
          display: flex;
          flex-direction: column;
          gap: 0.3125rem;
          font-size: 0.75rem;
        }
        .row {
          display: flex;
          gap: 0.625rem;
          align-items: baseline;
        }
        dt {
          flex: 0 0 5.75rem;
          font-family: var(--font-mono);
          font-size: 0.5625rem;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          color: var(--muted-foreground);
        }
        dd {
          margin: 0;
          min-width: 0;
        }
        .mono {
          font-family: var(--font-mono);
          font-size: 0.6875rem;
        }
        .qualifier {
          margin-left: 0.375rem;
          font-size: 0.6875rem;
          color: var(--muted-foreground);
        }
      </style>
    </template>
  };
}

// What a track says about itself. One shape across every tagging convention;
// `scheme` records which one supplied the values, because the conventions
// disagree on meaning — an ID3v2 `TRCK` is the string "4/12" while an MP4 `trkn`
// atom is a pair of integers — so `track` stays a string rather than being
// coerced into a number that loses the total.
export class MediaTagsField extends FieldDef {
  static displayName = 'Media Tags';
  static icon = TagsIcon;

  @field scheme = contains(CodedValueField);
  // Not `title`: FileDef's own name is the file's identity, and a field called
  // `title` here would read as though it renamed the file.
  @field trackTitle = contains(StringField);
  @field artist = contains(StringField);
  @field album = contains(StringField);
  @field albumArtist = contains(StringField);
  @field composer = contains(StringField);
  @field year = contains(NumberField);
  @field track = contains(StringField);
  @field disc = contains(StringField);
  @field genre = contains(StringField);
  @field comment = contains(TextAreaField);

  static embedded = class Embedded extends Component<typeof MediaTagsField> {
    <template>
      <dl class='metadata-rows'>
        {{#if @model.trackTitle}}
          <div class='row'><dt>Title</dt><dd>{{@model.trackTitle}}</dd></div>
        {{/if}}
        {{#if @model.artist}}
          <div class='row'><dt>Artist</dt><dd>{{@model.artist}}</dd></div>
        {{/if}}
        {{#if @model.album}}
          <div class='row'><dt>Album</dt><dd>{{@model.album}}</dd></div>
        {{/if}}
        {{#if @model.albumArtist}}
          <div class='row'><dt>Album artist</dt><dd>{{@model.albumArtist}}</dd></div>
        {{/if}}
        {{#if @model.composer}}
          <div class='row'><dt>Composer</dt><dd>{{@model.composer}}</dd></div>
        {{/if}}
        {{#if @model.year}}
          <div class='row'><dt>Year</dt><dd>{{@model.year}}</dd></div>
        {{/if}}
        {{#if @model.track}}
          <div class='row'><dt>Track</dt><dd>{{@model.track}}</dd></div>
        {{/if}}
        {{#if @model.disc}}
          <div class='row'><dt>Disc</dt><dd>{{@model.disc}}</dd></div>
        {{/if}}
        {{#if @model.genre}}
          <div class='row'><dt>Genre</dt><dd>{{@model.genre}}</dd></div>
        {{/if}}
        {{#if @model.comment}}
          <div class='row'><dt>Comment</dt><dd>{{@model.comment}}</dd></div>
        {{/if}}
        {{#if @model.scheme.label}}
          <div class='row'><dt>Scheme</dt><dd><@fields.scheme /></dd></div>
        {{/if}}
      </dl>
      <style scoped>
        .metadata-rows {
          margin: 0;
          display: flex;
          flex-direction: column;
          gap: 0.3125rem;
          font-size: 0.75rem;
        }
        .row {
          display: flex;
          gap: 0.625rem;
          align-items: baseline;
        }
        dt {
          flex: 0 0 5.75rem;
          font-family: var(--font-mono);
          font-size: 0.5625rem;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          color: var(--muted-foreground);
        }
        dd {
          margin: 0;
          min-width: 0;
          overflow-wrap: anywhere;
        }
      </style>
    </template>
  };
}

// A decoded amplitude envelope, produced by actually decoding the audio rather
// than by reading a header — so unlike every other field here it depends on Web
// Audio being available, and records why it isn't when it fails.
//
// `bars` is the envelope itself, resampled at extract time to a fixed count so
// the stored payload is bounded no matter how long the track is. It is stored as
// a JSON string rather than a `containsMany(NumberField)` deliberately: a
// hundred-odd separate field instances would cost far more to serialize, index,
// and rehydrate than one short string, and nothing queries an individual bar.
export class WaveformMetadataField extends FieldDef {
  static displayName = 'Waveform Analysis';
  static icon = AudioWaveformIcon;

  // 'ok' | 'unsupported' | 'failed' — a renderer needs to tell "no waveform yet"
  // from "this file cannot produce one", and an operator needs to know which.
  @field decodeStatus = contains(StringField);
  @field decodeError = contains(StringField);
  // Names the resampling so a stored envelope stays interpretable if the
  // algorithm changes; a consumer can tell an old envelope from a new one.
  @field algorithm = contains(StringField);
  @field barsJson = contains(TextAreaField);
  @field barCount = contains(NumberField);
  @field durationSeconds = contains(NumberField);
  @field sampleRateHz = contains(NumberField);
  @field channelCount = contains(NumberField);
  @field peakAmplitude = contains(NumberField);
  @field rmsAmplitude = contains(NumberField);

  static embedded = class Embedded extends Component<
    typeof WaveformMetadataField
  > {
    <template>
      <dl class='metadata-rows'>
        {{#if @model.decodeStatus}}
          <div class='row'><dt>Status</dt><dd>{{@model.decodeStatus}}</dd></div>
        {{/if}}
        {{#if @model.barCount}}
          <div class='row'><dt>Envelope</dt><dd>{{@model.barCount}} bars ·
              {{@model.algorithm}}</dd></div>
        {{/if}}
        {{#if @model.durationSeconds}}
          <div class='row'><dt>Duration</dt><dd>{{@model.durationSeconds}} s</dd></div>
        {{/if}}
        {{#if @model.sampleRateHz}}
          <div class='row'><dt>Sample rate</dt><dd>{{@model.sampleRateHz}} Hz</dd></div>
        {{/if}}
        {{#if @model.channelCount}}
          <div class='row'><dt>Channels</dt><dd>{{@model.channelCount}}</dd></div>
        {{/if}}
        {{#if @model.peakAmplitude}}
          <div class='row'><dt>Peak</dt><dd>{{@model.peakAmplitude}}</dd></div>
        {{/if}}
        {{#if @model.rmsAmplitude}}
          <div class='row'><dt>RMS</dt><dd>{{@model.rmsAmplitude}}</dd></div>
        {{/if}}
        {{#if @model.decodeError}}
          <div class='row'><dt>Decode</dt><dd class='decode-error'>{{@model.decodeError}}</dd></div>
        {{/if}}
      </dl>
      <style scoped>
        .metadata-rows {
          margin: 0;
          display: flex;
          flex-direction: column;
          gap: 0.3125rem;
          font-size: 0.75rem;
        }
        .row {
          display: flex;
          gap: 0.625rem;
          align-items: baseline;
        }
        dt {
          flex: 0 0 5.75rem;
          font-family: var(--font-mono);
          font-size: 0.5625rem;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          color: var(--muted-foreground);
        }
        dd {
          margin: 0;
          min-width: 0;
          overflow-wrap: anywhere;
        }
        .decode-error {
          color: var(--destructive, var(--foreground));
        }
      </style>
    </template>
  };
}
