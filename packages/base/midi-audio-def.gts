import { readFirstBytes } from '@cardstack/runtime-common';
import KeyboardMusicIcon from '@cardstack/boxel-icons/keyboard-music';
import { NumberField, contains, field } from './card-api';
import { FileDef, type ByteStream, type SerializedFile } from './file-api';
import { MidiMetadataField } from './file-formats/metadata-fields';
import { MidiPreview } from './file-formats/midi-preview';
import { extractMidiMetadata, type MidiMetadata } from './midi-meta-extractor';
import type { FilePreviewComponent } from './file-formats/file-preview-stage';

// MIDI files are small — note events, not samples — so the whole file fits well
// inside a single bounded read. A megabyte is a very long sequence; anything
// larger is padding or corruption, and the walk's own event cap bounds the rest.
const MIDI_MAX_BYTES = 1_048_576;

// MIDI extends `FileDef` rather than `AudioDef` on purpose.
//
// A Standard MIDI File is symbolic performance data: a list of which notes to
// play and when, with no sound until a synthesizer renders it. It therefore has
// none of what `AudioDef` declares — no sample rate, no bit depth, no channel
// layout, and no amplitude envelope to decode. Inheriting those would make every
// MIDI file advertise fields it can never fill.
//
// The taxonomy registry already models this as its own `music` family, distinct
// from `audio`, and this is the class that realizes that distinction.
export class MidiDef extends FileDef {
  static displayName = 'MIDI Sequence';
  static icon = KeyboardMusicIcon;
  static acceptTypes = '.mid,.midi,audio/midi,audio/x-midi';
  // The registry already models MIDI as its own `music` family; pin it so a
  // `.mid` served without a content type still routes there rather than to a
  // generic file profile.
  static fileFamily = 'music';

  // Derived by walking the tempo map to the last event, so a piece that changes
  // tempo reports the time it actually takes rather than an average.
  @field duration = contains(NumberField);

  @field midi = contains(MidiMetadataField);

  // The sequence has no sound to play and no waveform to draw, so its renderer
  // presents the symbolic performance instead: a pitch band and a fact summary.
  static previewComponent: FilePreviewComponent = MidiPreview;

  static async extractAttributes(
    url: string,
    getStream: () => Promise<ByteStream>,
    options: { contentHash?: string; contentSize?: number } = {},
  ): Promise<SerializedFile<{ duration?: number; midi?: MidiMetadata }>> {
    let base = await super.extractAttributes(url, getStream, options);
    let bytes = await readFirstBytes(await getStream(), MIDI_MAX_BYTES);
    // Throws FileContentMismatchError when the file isn't SMF, which is how the
    // extractor knows to fall back to the base FileDef.
    let midi = extractMidiMetadata(bytes);

    return {
      ...base,
      ...(midi.durationSeconds === undefined
        ? {}
        : { duration: midi.durationSeconds }),
      midi,
    };
  }
}

export default MidiDef;
