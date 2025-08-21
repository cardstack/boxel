import { fn, concat } from '@ember/helper';
import {
  CardDef,
  FieldDef,
  field,
  contains,
  containsMany,
  Component,
} from 'https://cardstack.com/base/card-api'; // ¹ Core imports
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import TextAreaField from 'https://cardstack.com/base/text-area';
import MarkdownField from 'https://cardstack.com/base/markdown';
import { Button } from '@cardstack/boxel-ui/components'; // ² UI components
import { eq, gt } from '@cardstack/boxel-ui/helpers';
import { on } from '@ember/modifier';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import MusicIcon from '@cardstack/boxel-icons/music';
import { htmlSafe } from '@ember/template';

// ³ Chord Definition Field - simplified structure
export class ChordField extends FieldDef {
  static displayName = 'Chord';
  static icon = MusicIcon;

  @field chordName = contains(StringField); // ⁴ e.g., "C", "Am", "G7" - the complete chord symbol
  @field notes = containsMany(StringField); // Array of note strings for playback

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='chord-field'>
        <div class='chord-symbol'>{{if
            @model.chordName
            @model.chordName
            'Chord'
          }}</div>
        <div class='chord-details'>
          {{#if (gt @model.notes.length 0)}}
            <div class='chord-notes'>
              {{#each @model.notes as |note|}}
                <span class='note'>{{note}}</span>
              {{/each}}
            </div>
          {{/if}}
        </div>
      </div>

      <style scoped>
        .chord-field {
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          padding: 0.75rem;
          text-align: center;
          transition: all 0.2s ease;
          min-width: 80px;
        }

        .chord-field:hover {
          border-color: #3b82f6;
          background: #eff6ff;
        }

        .chord-symbol {
          font-size: 1.125rem;
          font-weight: 700;
          color: #1e293b;
          margin-bottom: 0.375rem;
          font-family: 'Georgia', serif;
        }

        .chord-notes {
          display: flex;
          justify-content: center;
          gap: 0.25rem;
          flex-wrap: wrap;
        }

        .note {
          background: #3b82f6;
          color: white;
          padding: 0.125rem 0.375rem;
          border-radius: 12px;
          font-size: 0.625rem;
          font-weight: 600;
        }
      </style>
    </template>
  };
}

// ⁵ Song Section Field - individual song sections
export class SongSectionField extends FieldDef {
  static displayName = 'Song Section';
  static icon = MusicIcon;

  @field sectionName = contains(StringField); // ⁶ Intro, Verse, Chorus, Bridge, Outro
  @field lyrics = contains(MarkdownField); // Full lyrics with formatting
  @field chords = containsMany(ChordField); // Chord progression for this section
  @field duration = contains(NumberField); // Section duration in seconds
  @field notes = contains(TextAreaField); // Producer notes for this section

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='song-section'>
        <div class='section-header'>
          <h4 class='section-name'>{{if
              @model.sectionName
              @model.sectionName
              'Section'
            }}</h4>
          {{#if @model.duration}}
            <span class='section-duration'>{{@model.duration}}s</span>
          {{/if}}
        </div>

        {{#if (gt @model.chords.length 0)}}
          <div class='section-chords'>
            <label class='chords-label'>Chords:</label>
            <div class='chords-container'>
              <@fields.chords @format='embedded' />
            </div>
          </div>
        {{/if}}

        {{#if @model.lyrics}}
          <div class='section-lyrics'>
            <label class='lyrics-label'>Lyrics:</label>
            <div class='lyrics-content'>
              <@fields.lyrics @format='embedded' />
            </div>
          </div>
        {{else if @model.lyrics}}
          <div class='section-lyrics'>
            <label class='lyrics-label'>Lyrics:</label>
            <div class='lyrics-content-text'>{{@model.lyrics}}</div>
          </div>
        {{/if}}

        {{#if @model.notes}}
          <div class='section-notes'>
            <label class='notes-label'>Notes:</label>
            <div class='notes-content'>{{@model.notes}}</div>
          </div>
        {{/if}}
      </div>

      <style scoped>
        .song-section {
          background: white;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          padding: 1rem;
          margin-bottom: 1rem;
        }

        .section-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 0.75rem;
          padding-bottom: 0.5rem;
          border-bottom: 1px solid #f1f5f9;
        }

        .section-name {
          font-size: 1rem;
          font-weight: 700;
          color: #1e293b;
          margin: 0;
          text-transform: capitalize;
        }

        .section-duration {
          background: #eff6ff;
          color: #1e40af;
          padding: 0.25rem 0.5rem;
          border-radius: 6px;
          font-size: 0.75rem;
          font-weight: 600;
        }

        .section-chords,
        .section-lyrics,
        .section-notes {
          margin-bottom: 0.75rem;
        }

        /* ⁴⁰ Make lyrics sections more prominent */
        .section-lyrics {
          margin-bottom: 1rem;
        }

        .section-lyrics .lyrics-content,
        .section-lyrics .lyrics-content-text {
          max-height: none; /* Allow full lyrics to show */
          overflow: visible;
        }

        .chords-label,
        .lyrics-label,
        .notes-label {
          display: block;
          font-size: 0.75rem;
          font-weight: 600;
          color: #64748b;
          margin-bottom: 0.5rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .chords-container > .containsMany-field {
          display: flex;
          gap: 0.5rem;
          flex-wrap: wrap;
        }

        .lyrics-content {
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          padding: 1rem; /* ³⁶ More padding for comfortable reading */
          font-size: 1rem; /* Larger font for better readability */
          line-height: 1.7; /* Better line spacing for lyrics */
          color: #1e293b; /* ³⁷ Higher contrast text color */
          font-family:
            'Georgia', serif; /* Better serif for lyrics readability */
        }

        .lyrics-content-text {
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          padding: 1rem; /* ³⁸ More padding for comfortable reading */
          font-size: 1rem; /* Larger font for better readability */
          line-height: 1.7; /* Better line spacing for lyrics */
          white-space: pre-wrap;
          color: #1e293b; /* ³⁹ Higher contrast text color */
          font-family:
            'Georgia', serif; /* Better serif for lyrics readability */
        }

        .notes-content {
          font-size: 0.75rem;
          color: #64748b;
          font-style: italic;
          line-height: 1.4;
        }
      </style>
    </template>
  };
}

// ⁵ Track Field - simplified for song building
export class TrackField extends FieldDef {
  static displayName = 'Track';
  static icon = MusicIcon;

  @field trackName = contains(StringField); // ⁶ Track identification
  @field instrument = contains(StringField); // Piano, Guitar, Drums, Bass, etc.
  @field volume = contains(NumberField); // 0-100 volume level
  @field notes = contains(TextAreaField); // Track-specific notes

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='track-field'>
        <div class='track-header'>
          <div class='track-info'>
            <h5 class='track-name'>{{if
                @model.trackName
                @model.trackName
                'Unnamed Track'
              }}</h5>
            <span class='track-instrument'>{{if
                @model.instrument
                @model.instrument
                'Unknown'
              }}</span>
          </div>
        </div>

        <div class='track-levels'>
          <div class='level-group'>
            <label>Volume</label>
            <div class='level-bar'>
              <div
                class='level-fill'
                style={{htmlSafe
                  (concat 'width: ' (if @model.volume @model.volume 75) '%')
                }}
              ></div>
            </div>
            <span class='level-value'>{{if
                @model.volume
                @model.volume
                75
              }}</span>
          </div>
        </div>

        {{#if @model.notes}}
          <div class='track-notes'>
            <label class='notes-label'>Notes:</label>
            <div class='notes-content'>{{@model.notes}}</div>
          </div>
        {{/if}}
      </div>

      <style scoped>
        .track-field {
          background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
          border: 1px solid #d1d5db;
          border-radius: 8px;
          padding: 0.75rem;
          transition: all 0.2s ease;
        }

        .track-field:hover {
          border-color: #3b82f6;
          box-shadow: 0 2px 8px rgba(59, 130, 246, 0.1);
        }

        .track-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 0.75rem;
        }

        .track-name {
          font-size: 0.875rem;
          font-weight: 600;
          color: #1e293b;
          margin: 0 0 0.125rem 0;
        }

        .track-instrument {
          font-size: 0.75rem;
          color: #64748b;
          text-transform: capitalize;
        }

        .track-levels {
          margin-bottom: 0.75rem;
        }

        .level-group {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          font-size: 0.75rem;
        }

        .level-group label {
          min-width: 50px;
          color: #64748b;
          font-weight: 600;
        }

        .level-bar {
          flex: 1;
          height: 8px;
          background: #e5e7eb;
          border-radius: 4px;
          overflow: hidden;
        }

        .level-fill {
          height: 100%;
          background: linear-gradient(
            90deg,
            #10b981 0%,
            #34d399 50%,
            #fbbf24 80%,
            #ef4444 100%
          );
          border-radius: 4px;
          transition: width 0.2s ease;
        }

        .level-value {
          min-width: 30px;
          text-align: right;
          color: #374151;
          font-weight: 600;
          font-family: 'JetBrains Mono', monospace;
        }

        .track-notes {
          border-top: 1px solid #e5e7eb;
          padding-top: 0.75rem;
        }

        .notes-label {
          display: block;
          font-size: 0.75rem;
          font-weight: 600;
          color: #64748b;
          margin-bottom: 0.375rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .notes-content {
          font-size: 0.75rem;
          color: #374151;
          line-height: 1.4;
          font-style: italic;
        }
      </style>
    </template>
  };
}

// ⁷ Song Builder Isolated Component - Professional song creation interface
class SongBuilderIsolated extends Component<typeof SongBuilderCard> {
  @tracked currentTab = 'songInfo'; // songInfo, arrangement, tracks, mix
  @tracked isPlaying = false;
  @tracked currentTime = 0;
  @tracked playbackPosition = 0;

  // ¹⁷ Calculate total duration from song sections
  get totalDuration() {
    try {
      // Fallback to calculating from sections
      if (this.args?.model?.sections && this.args.model.sections.length > 0) {
        const total = this.args.model.sections.reduce((sum, section) => {
          return sum + (section.duration || 0);
        }, 0);
        return total > 0 ? total : 195; // Default fallback
      }

      return 195; // Default 3:15 song
    } catch (e) {
      console.error('Error calculating total duration:', e);
      return 195;
    }
  }

  // ⁸ Audio context for playback simulation
  audioContext: AudioContext | null = null;
  playbackTimer: number | null = null;
  activeOscillators: OscillatorNode[] = []; // ³² Track active oscillators for cleanup
  currentSectionIndex: number = 0; // ³³ Current playing section index
  sectionStartTime: number = 0; // ³⁴ When current section started

  // ⁵⁸ Lyric synchronization data structure
  @tracked currentLyricIndex = 0;
  @tracked currentLyricPhrase = '';
  @tracked lyricTimestamps: {
    text: string;
    startTime: number;
    endTime: number;
  }[] = [];

  // ⁶⁹ Musical melody synthesis for lyrics
  activeMelodyOscillators: OscillatorNode[] = [];
  @tracked melodyEnabled = true; // User can toggle melody on/off

  // ³⁵ Enhanced note frequency mapping with multiple octaves for rich chord voicings
  noteFrequencies: { [key: string]: number } = {
    // Octave 2 (Bass register)
    C2: 65.41,
    D2: 73.42,
    E2: 82.41,
    F2: 87.31,
    G2: 98.0,
    A2: 110.0,
    B2: 123.47,
    'C#2': 69.3,
    Db2: 69.3,
    'D#2': 77.78,
    Eb2: 77.78,
    'F#2': 92.5,
    Gb2: 92.5,
    'G#2': 103.83,
    Ab2: 103.83,
    'A#2': 116.54,
    Bb2: 116.54,

    // Octave 3 (Low register)
    C3: 130.81,
    D3: 146.83,
    E3: 164.81,
    F3: 174.61,
    G3: 196.0,
    A3: 220.0,
    B3: 246.94,
    'C#3': 138.59,
    Db3: 138.59,
    'D#3': 155.56,
    Eb3: 155.56,
    'F#3': 185.0,
    Gb3: 185.0,
    'G#3': 207.65,
    Ab3: 207.65,
    'A#3': 233.08,
    Bb3: 233.08,

    // Octave 4 (Standard register)
    C: 261.63,
    C4: 261.63,
    D: 293.66,
    D4: 293.66,
    E: 329.63,
    E4: 329.63,
    F: 349.23,
    F4: 349.23,
    G: 392.0,
    G4: 392.0,
    A: 440.0,
    A4: 440.0,
    B: 493.88,
    B4: 493.88,
    'C#': 277.18,
    'C#4': 277.18,
    Db: 277.18,
    Db4: 277.18,
    'D#': 311.13,
    'D#4': 311.13,
    Eb: 311.13,
    Eb4: 311.13,
    'F#': 369.99,
    'F#4': 369.99,
    Gb: 369.99,
    Gb4: 369.99,
    'G#': 415.3,
    'G#4': 415.3,
    Ab: 415.3,
    Ab4: 415.3,
    'A#': 466.16,
    'A#4': 466.16,
    Bb: 466.16,
    Bb4: 466.16,

    // Octave 5 (High register)
    C5: 523.25,
    D5: 587.33,
    E5: 659.25,
    F5: 698.46,
    G5: 783.99,
    A5: 880.0,
    B5: 987.77,
    'C#5': 554.37,
    Db5: 554.37,
    'D#5': 622.25,
    Eb5: 622.25,
    'F#5': 739.99,
    Gb5: 739.99,
    'G#5': 830.61,
    Ab5: 830.61,
    'A#5': 932.33,
    Bb5: 932.33,
  };

  constructor(owner: any, args: any) {
    super(owner, args);
    this.initializeAudio();
  }

  async initializeAudio() {
    try {
      this.audioContext = new (window.AudioContext ||
        (window as any).webkitAudioContext)();

      // Check if audio context is suspended and resume if needed
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      console.log('Audio context initialized:', this.audioContext.state);
    } catch (e) {
      console.warn('Web Audio API not supported:', e);
    }
  }

  @action
  switchTab(tab: string) {
    this.currentTab = tab;
  }

  @action
  togglePlayback() {
    console.log('Toggle playback clicked, currently playing:', this.isPlaying);
    if (this.isPlaying) {
      this.stopPlayback();
    } else {
      this.startPlayback();
    }
  }

  async startPlayback() {
    console.log(
      'Starting arrangement playback, total duration:',
      this.totalDuration,
    );

    // Ensure audio context is ready
    if (!this.audioContext) {
      await this.initializeAudio();
    }

    if (this.audioContext && this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
      console.log('Audio context resumed');
    }

    this.isPlaying = true;
    this.currentTime = 0;
    this.playbackPosition = 0;
    this.currentSectionIndex = 0;
    this.sectionStartTime = 0;

    // ⁵⁹ Initialize lyric synchronization
    this.initializeLyricSync();

    // ²⁰ Start playing the first section's chords immediately
    this.playCurrentSectionChords();

    // More precise timing with smaller intervals for smoother playback
    this.playbackTimer = window.setInterval(() => {
      this.currentTime += 0.5; // Half-second precision for smoother updates
      this.playbackPosition = Math.min(
        (this.currentTime / this.totalDuration) * 100,
        100,
      );

      // ⁶⁰ Update lyric highlighting
      this.updateLyricHighlight();

      // ²¹ Check if we should move to next section
      this.checkSectionProgress();

      // Stop when reaching total duration
      if (this.currentTime >= this.totalDuration) {
        this.stopPlayback();
        this.resetPlayback();
      }
    }, 500); // 500ms intervals for smoother timing
  }

  // ²² Play chord progression for current section with musical rhythm patterns
  playCurrentSectionChords() {
    const sections = this.args?.model?.sections;
    if (!sections || sections.length === 0) return;

    const currentSection = sections[this.currentSectionIndex];
    if (
      !currentSection ||
      !currentSection.chords ||
      currentSection.chords.length === 0
    )
      return;

    console.log(
      `Playing section: ${currentSection.sectionName} with ${currentSection.chords.length} chords`,
    );

    // ⁴⁷ Simpler, more natural chord timing
    const chordsCount = currentSection.chords.length;
    const sectionDuration = currentSection.duration || 32;
    const chordDuration = sectionDuration / chordsCount; // Even distribution

    // ⁴⁸ Play chords with natural, even spacing
    let playTime = 0;
    currentSection.chords.forEach((chord, index) => {
      setTimeout(() => {
        if (this.isPlaying) {
          // ⁴⁹ Longer note duration for sections with fewer chords
          const noteDuration = Math.max(chordDuration + 1.0, 3.0); // Minimum 3 seconds, plus 1 second overlap
          const hasNextChord = index < chordsCount - 1;
          this.playChordSmooth(chord, noteDuration, hasNextChord);
        }
      }, playTime * 1000);

      playTime += chordDuration;
    });
  }

  // ²⁴ Check if we should advance to next section with musical timing
  checkSectionProgress() {
    const sections = this.args?.model?.sections;
    if (!sections || sections.length === 0) return;

    const currentSection = sections[this.currentSectionIndex];
    const sectionElapsed = this.currentTime - this.sectionStartTime;

    // ⁵⁵ More precise section timing with musical boundaries
    const sectionDuration = currentSection?.duration || 0;

    // Allow slight timing flexibility for musical flow
    if (sectionElapsed >= sectionDuration - 0.1) {
      // 100ms early transition allowed
      this.currentSectionIndex++;
      this.sectionStartTime = this.currentTime;

      // Play next section if exists
      if (this.currentSectionIndex < sections.length) {
        console.log(
          `Transitioning to section ${this.currentSectionIndex}: ${
            sections[this.currentSectionIndex].sectionName
          }`,
        );

        // ⁵⁶ Immediate transition for better musical flow
        this.playCurrentSectionChords();
      }
    }
  }

  // ⁴¹ Convert chord object to proper frequency array with voicing
  getChordFrequencies(chord: any): number[] {
    if (!chord) return [];

    // If chord has explicit notes array, use that
    if (chord.notes && Array.isArray(chord.notes)) {
      return chord.notes
        .map(
          (note: string) =>
            this.noteFrequencies[note] || this.noteFrequencies[note + '4'],
        )
        .filter((freq: number) => freq > 0);
    }

    // Otherwise, generate from chord name and type
    const rootNote = chord.rootNote || chord.chordName?.charAt(0) || 'C';
    const quality = chord.quality || chord.chordType || 'major';

    return this.generateChordFromSymbol(rootNote, quality);
  }

  // ⁴² Generate natural, balanced chord frequencies
  generateChordFromSymbol(rootNote: string, quality: string): number[] {
    const frequencies: number[] = [];

    // Root note in octave 4 (middle register)
    const rootFreq =
      this.noteFrequencies[rootNote + '4'] || this.noteFrequencies[rootNote];
    if (rootFreq) frequencies.push(rootFreq);

    // Generate intervals based on chord quality - closer voicing for better sound
    switch (quality.toLowerCase()) {
      case 'major':
        frequencies.push(this.getInterval(rootNote, 4, '4')); // Major 3rd
        frequencies.push(this.getInterval(rootNote, 7, '4')); // Perfect 5th
        break;

      case 'minor':
        frequencies.push(this.getInterval(rootNote, 3, '4')); // Minor 3rd
        frequencies.push(this.getInterval(rootNote, 7, '4')); // Perfect 5th
        break;

      case 'dominant7':
      case 'dom7':
      case '7':
        frequencies.push(this.getInterval(rootNote, 4, '4')); // Major 3rd
        frequencies.push(this.getInterval(rootNote, 7, '4')); // Perfect 5th
        frequencies.push(this.getInterval(rootNote, 10, '4')); // Minor 7th
        break;

      case 'minor7':
      case 'm7':
        frequencies.push(this.getInterval(rootNote, 3, '4')); // Minor 3rd
        frequencies.push(this.getInterval(rootNote, 7, '4')); // Perfect 5th
        frequencies.push(this.getInterval(rootNote, 10, '4')); // Minor 7th
        break;

      case 'diminished':
      case 'dim':
        frequencies.push(this.getInterval(rootNote, 3, '4')); // Minor 3rd
        frequencies.push(this.getInterval(rootNote, 6, '4')); // Diminished 5th
        break;

      default: // Default to major if unknown
        frequencies.push(this.getInterval(rootNote, 4, '4')); // Major 3rd
        frequencies.push(this.getInterval(rootNote, 7, '4')); // Perfect 5th
    }

    return frequencies.filter((freq) => freq > 0);
  }

  // ⁴³ Get interval frequency from root note
  getInterval(
    rootNote: string,
    semitones: number,
    octave: string = '4',
  ): number {
    const noteOrder = [
      'C',
      'C#',
      'D',
      'D#',
      'E',
      'F',
      'F#',
      'G',
      'G#',
      'A',
      'A#',
      'B',
    ];
    const rootIndex = noteOrder.findIndex((note) => rootNote.startsWith(note));

    if (rootIndex === -1) return 0;

    const targetIndex = (rootIndex + semitones) % 12;
    const targetNote = noteOrder[targetIndex];

    // Handle octave wrapping
    let targetOctave = parseInt(octave);
    if (rootIndex + semitones >= 12) {
      targetOctave += Math.floor((rootIndex + semitones) / 12);
    }

    return (
      this.noteFrequencies[targetNote + targetOctave] ||
      this.noteFrequencies[targetNote]
    );
  }

  // ⁵¹ Play chord with musical rhythm pattern instead of sustained notes
  playChordWithRhythm(chordData: any, beats: number, beatLength: number) {
    if (!this.audioContext || !chordData) return;

    // ⁵² Create strumming pattern based on number of beats
    const strumPattern = this.getStrumPattern(beats);

    strumPattern.forEach((strumTime, index) => {
      setTimeout(
        () => {
          if (this.isPlaying) {
            // ⁵³ Play chord with shorter, more musical duration
            const noteDuration = Math.min(beatLength * 1.2, 2.0); // 1.2 beats max, 2 seconds max
            const hasNextChord = index < strumPattern.length - 1;
            this.playChordSmooth(chordData, noteDuration, hasNextChord);
          }
        },
        strumTime * beatLength * 1000,
      );
    });
  }

  // ⁵⁴ Generate strumming patterns based on beat count
  getStrumPattern(beats: number): number[] {
    // Return array of beat positions when to trigger chord
    switch (beats) {
      case 2:
        return [0, 1]; // Every beat
      case 3:
        return [0, 1.5]; // On 1 and 2.5
      case 4:
        return [0, 1, 2, 3]; // Every beat (4/4 time)
      case 5:
        return [0, 1.5, 3]; // Irregular pattern
      case 6:
        return [0, 2, 4]; // Every 2 beats
      case 8:
        return [0, 2, 4, 6]; // Every 2 beats (slow)
      default:
        return [0]; // Just once on downbeat
    }
  }

  // ⁴⁴ Synthesize and play a chord with smoother pad-like synthesis
  playChordSmooth(
    chordData: any,
    duration: number = 2.0,
    hasNextChord: boolean = true,
  ) {
    if (!this.audioContext || !chordData) {
      console.warn('Cannot play chord:', {
        audioContext: !!this.audioContext,
        chordData: !!chordData,
      });
      return;
    }

    // Convert chord to frequencies using new harmonic interpretation
    const frequencies = this.getChordFrequencies(chordData);
    if (frequencies.length === 0) {
      console.warn('No frequencies generated for chord:', chordData);
      return;
    }

    console.log(
      'Playing chord:',
      chordData.chordName,
      'with frequencies:',
      frequencies,
    );

    // Don't stop existing notes for smooth bridging - let them overlap and fade
    const currentTime = this.audioContext.currentTime;

    const masterGain = this.audioContext.createGain();
    masterGain.connect(this.audioContext.destination);
    masterGain.gain.setValueAtTime(0.035, currentTime); // Much higher volume for chord foundation

    frequencies.forEach((frequency) => {
      if (!frequency) return;

      const oscillator = this.audioContext!.createOscillator();
      const gainNode = this.audioContext!.createGain();
      const filter = this.audioContext!.createBiquadFilter();

      // ⁵⁷ Natural pad synthesis with softer, more realistic sound
      oscillator.type = 'sawtooth'; // Brighter wave for more presence
      oscillator.frequency.setValueAtTime(frequency, currentTime);

      // Subtle natural variation - like analog warmth
      const detuneAmount = (Math.random() - 0.5) * 3; // Much smaller detune: ±1.5 cents
      oscillator.detune.setValueAtTime(detuneAmount, currentTime);

      // Warm, musical low-pass filter
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(2500, currentTime); // Lower cutoff for warmth
      filter.Q.setValueAtTime(0.8, currentTime); // Slight resonance for character

      // Natural, musical envelope - like a string section
      gainNode.gain.setValueAtTime(0, currentTime);

      // Faster, more natural attack - not sluggish
      gainNode.gain.exponentialRampToValueAtTime(0.001, currentTime + 0.001); // Start tiny
      gainNode.gain.exponentialRampToValueAtTime(0.6, currentTime + 0.3); // Faster attack, MUCH higher level

      // Higher sustain level for better presence
      gainNode.gain.setValueAtTime(0.55, currentTime + 0.5);

      // Natural release that varies based on chord changes
      const releaseStart = hasNextChord ? duration - 0.8 : duration - 1.2;
      const finalGain = hasNextChord ? 0.25 : 0.001; // Higher overlap level for smoother transitions

      gainNode.gain.setValueAtTime(0.55, currentTime + releaseStart);
      gainNode.gain.exponentialRampToValueAtTime(
        finalGain,
        currentTime + duration,
      );

      oscillator.connect(filter);
      filter.connect(gainNode);
      gainNode.connect(masterGain);

      oscillator.start(currentTime);
      oscillator.stop(currentTime + duration);

      this.activeOscillators.push(oscillator);
    });

    // Clean up old oscillators that have finished (prevent memory leak)
    setTimeout(
      () => {
        this.cleanupFinishedOscillators();
      },
      (duration + 0.5) * 1000,
    );
  }

  // New method to clean up finished oscillators
  cleanupFinishedOscillators() {
    this.activeOscillators = this.activeOscillators.filter((osc) => {
      try {
        // If oscillator is still running, keep it
        return osc.context.state === 'running';
      } catch (e) {
        // If oscillator has finished or errored, remove it
        return false;
      }
    });
  }

  // ²⁸ Stop all currently playing notes
  stopAllNotes() {
    this.activeOscillators.forEach((osc) => {
      try {
        osc.stop();
      } catch (e) {
        // Oscillator might already be stopped
      }
    });
    this.activeOscillators = [];
  }

  stopPlayback() {
    this.isPlaying = false;
    this.stopAllNotes(); // ²⁹ Stop audio when stopping playback
    this.stopMelodySynthesis(); // ⁷¹ Stop melody synthesis
    if (this.playbackTimer) {
      clearInterval(this.playbackTimer);
      this.playbackTimer = null;
    }
  }

  @action
  resetPlayback() {
    console.log('Reset playback');
    this.currentTime = 0;
    this.playbackPosition = 0;
    this.currentSectionIndex = 0; // ³⁰ Reset section tracking
    this.sectionStartTime = 0;
    this.currentLyricIndex = 0; // ⁶¹ Reset lyric tracking
    this.currentLyricPhrase = '';
    this.stopPlayback();
  }

  @action
  updateTempo(event: Event) {
    const target = event.target as HTMLInputElement;
    const value = parseInt(target.value);
    if (this.args.model) {
      this.args.model.tempo = value;
    }
  }

  @action
  updateKey(event: Event) {
    const target = event.target as HTMLSelectElement;
    const value = target.value;
    if (this.args.model) {
      this.args.model.key = value;
    }
  }

  // ¹¹ Format time display
  get formattedCurrentTime() {
    const minutes = Math.floor(this.currentTime / 60);
    const seconds = this.currentTime % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  get formattedTotalDuration() {
    const minutes = Math.floor(this.totalDuration / 60);
    const seconds = this.totalDuration % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  // ⁶² Parse lyrics into synchronized phrases with timing
  initializeLyricSync() {
    const sections = this.args?.model?.sections;
    if (!sections || sections.length === 0) return;

    this.lyricTimestamps = [];
    let currentTime = 0;

    sections.forEach((section: any) => {
      if (!section.lyrics) return;

      const sectionDuration = section.duration || 32;
      const lyricLines = this.parseLyricsToLines(section.lyrics);

      if (lyricLines.length === 0) return;

      const timePerLine = sectionDuration / lyricLines.length;

      lyricLines.forEach((line, index) => {
        const startTime = currentTime + index * timePerLine;
        const endTime = startTime + timePerLine;

        this.lyricTimestamps.push({
          text: line,
          startTime,
          endTime,
        });
      });

      currentTime += sectionDuration;
    });

    console.log(
      'Initialized lyric sync:',
      this.lyricTimestamps.length,
      'phrases',
    );
  }

  // ⁶³ Parse lyrics text into individual lines for timing
  parseLyricsToLines(lyrics: string): string[] {
    if (!lyrics) return [];

    return lyrics
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => {
        // Filter out empty lines, markdown headers, and stage directions
        return (
          line.length > 0 &&
          !line.startsWith('**') &&
          !line.startsWith('*[') &&
          !line.startsWith('#')
        );
      });
  }

  // ⁶⁴ Update current lyric highlighting based on playback time
  updateLyricHighlight() {
    if (this.lyricTimestamps.length === 0) return;

    const currentPhrase = this.lyricTimestamps.find(
      (phrase) =>
        this.currentTime >= phrase.startTime &&
        this.currentTime < phrase.endTime,
    );

    if (currentPhrase) {
      const wasNewPhrase = this.currentLyricPhrase !== currentPhrase.text;
      this.currentLyricPhrase = currentPhrase.text;
      this.currentLyricIndex = this.lyricTimestamps.indexOf(currentPhrase);

      // ⁷² Play the new lyric phrase as melody when it changes
      if (wasNewPhrase && this.melodyEnabled) {
        this.playLyricMelody(currentPhrase.text);
      }
    }
  }

  // ⁶⁵ Get formatted lyrics with current phrase highlighting
  get synchronizedLyrics() {
    const sections = this.args?.model?.sections;
    if (!sections || sections.length === 0) return [];

    return sections.map((section: any, sectionIndex: number) => {
      const lines = this.parseLyricsToLines(section.lyrics || '');

      return {
        sectionName: section.sectionName,
        lines: lines.map((line) => ({
          text: line,
          isCurrent: line === this.currentLyricPhrase,
          isInCurrentSection: sectionIndex === this.currentSectionIndex,
        })),
      };
    });
  }

  // ⁷³ Play lyric phrase as musical melody
  playLyricMelody(text: string) {
    if (!this.audioContext || !text || !this.melodyEnabled) return;

    // Stop any currently playing melody
    this.stopMelodyNotes();

    // Clean up the text for melody generation
    const cleanText = this.cleanTextForSpeech(text);
    if (!cleanText) return;

    // Convert text to musical notes
    const melodyNotes = this.textToMelodyNotes(cleanText);
    if (melodyNotes.length === 0) return;

    // Play the melody notes
    this.playMelodySequence(melodyNotes);
  }

  // ⁷⁴ Convert text to sequence of musical notes with improved melodic flow
  textToMelodyNotes(text: string): { frequency: number; duration: number }[] {
    const words = text.split(/\s+/).filter((word) => word.length > 0);
    const notes: { frequency: number; duration: number }[] = [];

    // Current song key for melody generation
    const key = this.args?.model?.key || 'C Major';
    const scale = this.getScaleNotes(key);

    // ⁸² Enhanced melodic patterns with musical intelligence
    const melodyPatterns = this.generateMelodyPattern(words.length);

    words.forEach((word, index) => {
      // ⁸³ Musical characteristics from word analysis
      const wordLength = word.length;
      const vowelCount = (word.match(/[aeiou]/gi) || []).length;
      const consonantRatio = (wordLength - vowelCount) / wordLength;

      // ⁸⁴ Use pre-calculated melodic pattern for better flow
      let scaleIndex = melodyPatterns[index % melodyPatterns.length];

      // ⁸⁵ Adjust based on word characteristics for expressiveness
      if (vowelCount >= 3)
        scaleIndex = Math.min(scaleIndex + 1, scale.length - 1); // Higher for vowel-rich words
      if (consonantRatio > 0.7) scaleIndex = Math.max(scaleIndex - 1, 0); // Lower for consonant-heavy words

      // ⁸⁶ Add melodic intelligence based on phrase position
      if (index === 0) scaleIndex = 0; // Start on tonic
      if (index === words.length - 1) scaleIndex = 0; // End on tonic
      if (index === Math.floor(words.length / 2)) scaleIndex = 4; // Peak on dominant

      // ⁸⁷ Create smooth melodic motion - avoid large jumps
      if (index > 0 && notes.length > 0) {
        const lastIndex = this.frequencyToScaleIndex(
          notes[notes.length - 1].frequency,
          scale,
        );
        const maxJump = 3; // Maximum interval jump
        if (Math.abs(scaleIndex - lastIndex) > maxJump) {
          scaleIndex =
            lastIndex + (scaleIndex > lastIndex ? maxJump : -maxJump);
          scaleIndex = Math.max(0, Math.min(scaleIndex, scale.length - 1));
        }
      }

      const frequency = scale[scaleIndex];

      // ⁸⁸ More musical note durations with natural rhythm
      const baseDuration = 0.4; // Slightly longer base duration
      let duration = baseDuration;

      // Longer notes for important words (longer words, high vowel content)
      if (wordLength > 6 || vowelCount >= 3) duration *= 1.4;
      if (wordLength <= 3) duration *= 0.8; // Shorter for brief words

      // Rhythmic variation to avoid monotony
      if (index % 4 === 1) duration *= 1.2; // Slight emphasis on beat 2
      if (index % 8 === 7) duration *= 0.7; // Quick pickup note

      duration = Math.max(0.2, Math.min(1.2, duration)); // Clamp duration

      notes.push({ frequency, duration });
    });

    return notes;
  }

  // ⁷⁵ Get scale notes for current key with enhanced musical intelligence
  getScaleNotes(key: string): number[] {
    // ⁸⁹ Enhanced scale patterns for major and minor keys
    const scalePatterns = {
      major: [0, 2, 4, 5, 7, 9, 11, 12], // Major scale
      minor: [0, 2, 3, 5, 7, 8, 10, 12], // Natural minor scale
    };

    // ⁹⁰ Extract root note and mode from key (e.g., "C Major" -> "C", "major")
    const keyParts = key.toLowerCase().split(' ');
    const rootNote = keyParts[0].charAt(0).toUpperCase() + keyParts[0].slice(1);
    const mode = keyParts[1] === 'minor' ? 'minor' : 'major';

    // ⁹¹ Get base frequency for root note in a comfortable singing range (octave 4)
    const rootFreq =
      this.noteFrequencies[rootNote + '4'] || this.noteFrequencies['C4'];

    // ⁹² Select appropriate scale pattern
    const pattern = scalePatterns[mode];

    // ⁹³ Generate scale frequencies with extended range for better melody
    const baseScale = pattern.map((semitones) => {
      return rootFreq * Math.pow(2, semitones / 12);
    });

    // ⁹⁴ Add octave above for more melodic range
    const upperOctave = pattern.slice(1, 6).map((semitones) => {
      return rootFreq * Math.pow(2, (semitones + 12) / 12);
    });

    return [...baseScale, ...upperOctave]; // Extended 12-note melodic range
  }

  // ⁷⁶ Play sequence of melody notes with enhanced musical synthesis
  playMelodySequence(notes: { frequency: number; duration: number }[]) {
    if (!this.audioContext) return;

    let startTime = this.audioContext.currentTime + 0.1;

    notes.forEach((note, index) => {
      // ⁹⁵ Create more realistic instrument sound with multiple oscillators
      this.createMelodyNote(
        note.frequency,
        note.duration,
        startTime,
        index,
        notes.length,
      );

      // ⁹⁶ Natural timing with slight swing feel
      const swingRatio = index % 2 === 0 ? 1.0 : 0.9; // Subtle swing
      startTime += note.duration * 0.85 * swingRatio; // Smoother note transitions
    });
  }

  // ⁹⁷ Create individual melody note with rich harmonic content
  createMelodyNote(
    frequency: number,
    duration: number,
    startTime: number,
    index: number,
    totalNotes: number,
  ) {
    if (!this.audioContext) return;

    // ⁹⁸ Create layered sound for richer melody tone
    const fundamentalOsc = this.audioContext.createOscillator();
    const harmonicOsc = this.audioContext.createOscillator();
    const subOsc = this.audioContext.createOscillator();

    // ⁹⁹ Master gain and filter
    const masterGain = this.audioContext.createGain();
    const filter = this.audioContext.createBiquadFilter();
    const compressor = this.audioContext.createDynamicsCompressor();

    // ¹⁰⁰ Fundamental frequency (main melody note)
    fundamentalOsc.type = 'sawtooth';
    fundamentalOsc.frequency.setValueAtTime(frequency, startTime);

    // ¹⁰¹ Harmonic overtone for richness (octave above, quieter)
    harmonicOsc.type = 'triangle';
    harmonicOsc.frequency.setValueAtTime(frequency * 2, startTime);

    // ¹⁰² Sub-harmonic for warmth (octave below, very quiet)
    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(frequency * 0.5, startTime);

    // ¹⁰³ Individual gain nodes for mixing
    const fundGain = this.audioContext.createGain();
    const harmGain = this.audioContext.createGain();
    const subGain = this.audioContext.createGain();

    // ¹⁰⁴ Musical vibrato for expression
    const vibrato = this.audioContext.createOscillator();
    const vibratoGain = this.audioContext.createGain();
    vibrato.type = 'sine';
    vibrato.frequency.setValueAtTime(4.5, startTime); // Slightly slower vibrato
    vibratoGain.gain.setValueAtTime(2, startTime); // Reduced vibrato depth

    vibrato.connect(vibratoGain);
    vibratoGain.connect(fundamentalOsc.frequency);
    vibratoGain.connect(harmonicOsc.frequency);

    // ¹⁰⁵ Musical filter with dynamic movement
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(3200, startTime);
    filter.frequency.exponentialRampToValueAtTime(
      2400,
      startTime + duration * 0.7,
    ); // Filter sweep
    filter.Q.setValueAtTime(0.8, startTime);

    // ¹⁰⁶ Dynamic envelope based on position in phrase
    const isPhrasePeak = index === Math.floor(totalNotes / 2);
    const isPhrasEnd = index >= totalNotes - 2;

    // Base volumes for layered sound
    const baseVolume = isPhrasePeak ? 0.12 : 0.09; // Peak notes slightly louder
    const harmVolume = baseVolume * 0.3; // Harmonic at 30% of fundamental
    const subVolume = baseVolume * 0.2; // Sub at 20% of fundamental

    // ¹⁰⁷ Musical attack/decay envelope
    const attackTime = 0.03; // Quick but not instant attack
    const decayTime = duration * 0.2; // Decay over first 20% of note
    const sustainLevel = isPhrasEnd ? 0.6 : 0.8; // End notes fade more
    const releaseTime = duration * 0.3; // Smooth release

    // Set up envelopes for each layer
    [fundGain, harmGain, subGain].forEach((gainNode, layerIndex) => {
      const layerVolume = [baseVolume, harmVolume, subVolume][layerIndex];

      gainNode.gain.setValueAtTime(0, startTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + 0.001);
      gainNode.gain.exponentialRampToValueAtTime(
        layerVolume,
        startTime + attackTime,
      );
      gainNode.gain.exponentialRampToValueAtTime(
        layerVolume * sustainLevel,
        startTime + attackTime + decayTime,
      );
      gainNode.gain.setValueAtTime(
        layerVolume * sustainLevel,
        startTime + duration - releaseTime,
      );
      gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
    });

    // ¹⁰⁸ Audio routing with compression for professional sound
    fundamentalOsc.connect(fundGain);
    harmonicOsc.connect(harmGain);
    subOsc.connect(subGain);

    fundGain.connect(masterGain);
    harmGain.connect(masterGain);
    subGain.connect(masterGain);

    masterGain.connect(filter);
    filter.connect(compressor);
    compressor.connect(this.audioContext.destination);

    // Start all oscillators
    fundamentalOsc.start(startTime);
    harmonicOsc.start(startTime);
    subOsc.start(startTime);
    vibrato.start(startTime);

    // Stop all oscillators
    fundamentalOsc.stop(startTime + duration);
    harmonicOsc.stop(startTime + duration);
    subOsc.stop(startTime + duration);
    vibrato.stop(startTime + duration);

    // Track for cleanup
    this.activeMelodyOscillators.push(
      fundamentalOsc,
      harmonicOsc,
      subOsc,
      vibrato,
    );
  }

  // ⁷⁷ Stop all melody notes
  stopMelodyNotes() {
    this.activeMelodyOscillators.forEach((osc) => {
      try {
        osc.stop();
      } catch (e) {
        // Oscillator might already be stopped
      }
    });
    this.activeMelodyOscillators = [];
  }

  // ⁷⁸ Clean text for better speech synthesis
  cleanTextForSpeech(text: string): string {
    return text
      .replace(/\*\*/g, '') // Remove markdown bold
      .replace(/\*/g, '') // Remove markdown emphasis
      .replace(/\[.*?\]/g, '') // Remove stage directions
      .replace(/\(.*?\)/g, '') // Remove parenthetical notes
      .replace(/[#*_]/g, '') // Remove other markdown
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
  }

  // ⁷⁹ Stop current melody synthesis
  stopMelodySynthesis() {
    this.stopMelodyNotes();
  }

  // ¹⁰⁹ Generate intelligent melody patterns based on phrase length
  generateMelodyPattern(phraseLength: number): number[] {
    // ¹¹⁰ Musical patterns that create natural melodic arcs
    const patterns = {
      short: [0, 2, 0], // Simple up-down for 1-3 words
      medium: [0, 2, 4, 2, 0], // Classic arch shape for 4-6 words
      long: [0, 1, 3, 4, 5, 3, 1, 0], // Extended melodic journey for 7+ words
    };

    let basePattern;
    if (phraseLength <= 3) {
      basePattern = patterns.short;
    } else if (phraseLength <= 6) {
      basePattern = patterns.medium;
    } else {
      basePattern = patterns.long;
    }

    // ¹¹¹ Scale pattern to match phrase length
    const scaledPattern: number[] = [];
    for (let i = 0; i < phraseLength; i++) {
      const patternIndex = Math.floor(
        (i / phraseLength) * (basePattern.length - 1),
      );
      scaledPattern.push(basePattern[patternIndex]);
    }

    return scaledPattern;
  }

  // ¹¹² Convert frequency back to scale index for smooth melodic motion
  frequencyToScaleIndex(frequency: number, scale: number[]): number {
    let closestIndex = 0;
    let smallestDiff = Math.abs(frequency - scale[0]);

    for (let i = 1; i < scale.length; i++) {
      const diff = Math.abs(frequency - scale[i]);
      if (diff < smallestDiff) {
        smallestDiff = diff;
        closestIndex = i;
      }
    }

    return closestIndex;
  }

  // ⁸⁰ Toggle melody on/off
  @action
  toggleMelody() {
    this.melodyEnabled = !this.melodyEnabled;
    if (!this.melodyEnabled) {
      this.stopMelodySynthesis();
    }
  }

  // ³¹ Get current playing section for visual feedback
  get currentSection() {
    const sections = this.args?.model?.sections;
    if (!sections || sections.length === 0) return null;
    return sections[this.currentSectionIndex] || null;
  }

  // ¹² Key signature options
  keyOptions = [
    'C Major',
    'G Major',
    'D Major',
    'A Major',
    'E Major',
    'B Major',
    'F# Major',
    'C# Major',
    'F Major',
    'Bb Major',
    'Eb Major',
    'Ab Major',
    'Db Major',
    'Gb Major',
    'A Minor',
    'E Minor',
    'B Minor',
    'F# Minor',
    'C# Minor',
    'G# Minor',
    'D# Minor',
    'A# Minor',
    'D Minor',
    'G Minor',
    'C Minor',
    'F Minor',
    'Bb Minor',
    'Eb Minor',
  ];

  <template>
    <div class='song-builder'>
      <div class='builder-header'>
        <div class='header-content'>
          <div class='project-info'>
            <h1 class='builder-title'>
              <svg
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
                class='title-icon'
              >
                <path d='M9 18V5l12-2v13' />
                <circle cx='6' cy='18' r='3' />
                <circle cx='18' cy='16' r='3' />
              </svg>
              {{if @model.songTitle @model.songTitle 'Untitled Song'}}
            </h1>
            <p class='project-subtitle'>{{if
                @model.artist
                @model.artist
                'Unknown Artist'
              }}</p>
          </div>

          <div class='transport-section'>
            <div class='playback-controls'>
              <Button
                class='transport-btn play-btn
                  {{if this.isPlaying "playing" ""}}'
                {{on 'click' this.togglePlayback}}
              >
                {{#if this.isPlaying}}
                  <svg viewBox='0 0 24 24' fill='currentColor'>
                    <rect x='6' y='4' width='4' height='16' />
                    <rect x='14' y='4' width='4' height='16' />
                  </svg>
                {{else}}
                  <svg viewBox='0 0 24 24' fill='currentColor'>
                    <path d='M8 5v14l11-7z' />
                  </svg>
                {{/if}}
              </Button>

              <Button class='transport-btn' {{on 'click' this.resetPlayback}}>
                <svg
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  <rect x='6' y='6' width='12' height='12' />
                </svg>
              </Button>
            </div>

            <div class='timeline-section'>
              <div class='time-display'>
                <span class='current-time'>{{this.formattedCurrentTime}}</span>
                <span class='time-separator'>/</span>
                <span class='total-time'>{{this.formattedTotalDuration}}</span>
              </div>
              {{#if this.currentSection}}
                <div class='current-section-display'>
                  Playing:
                  {{this.currentSection.sectionName}}
                </div>
              {{/if}}

              {{#if this.currentLyricPhrase}}
                <div class='current-lyric-display'>
                  "{{this.currentLyricPhrase}}"
                </div>
              {{/if}}

              <div class='progress-timeline'>
                <div class='timeline-track'>
                  <div
                    class='playhead'
                    style={{htmlSafe
                      (concat 'left: ' this.playbackPosition '%')
                    }}
                  ></div>
                </div>
              </div>
            </div>

            <div class='key-controls'>
              <div class='control-group'>
                <label for='tempo-slider'>Tempo</label>
                <div class='tempo-control'>
                  <input
                    type='range'
                    id='tempo-slider'
                    min='60'
                    max='200'
                    value={{if @model.tempo @model.tempo 120}}
                    class='tempo-slider'
                    {{on 'input' this.updateTempo}}
                  />
                  <span class='tempo-value'>{{if @model.tempo @model.tempo 120}}
                    BPM</span>
                </div>
              </div>

              <div class='control-group'>
                <label for='key-select'>Key</label>
                <select
                  class='key-select'
                  id='key-select'
                  {{on 'change' this.updateKey}}
                >
                  {{#each this.keyOptions as |keyOption|}}
                    <option
                      value={{keyOption}}
                      selected={{eq keyOption @model.key}}
                    >
                      {{keyOption}}
                    </option>
                  {{/each}}
                </select>
              </div>

              <div class='control-group'>
                <label for='melody-toggle'>Melody</label>
                <Button
                  class='melody-toggle
                    {{if this.melodyEnabled "enabled" "disabled"}}'
                  {{on 'click' this.toggleMelody}}
                >
                  {{#if this.melodyEnabled}}
                    <svg
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='currentColor'
                      stroke-width='2'
                    >
                      <path d='M9 18V5l12-2v13' />
                      <circle cx='6' cy='18' r='3' />
                      <circle cx='18' cy='16' r='3' />
                    </svg>
                    ON
                  {{else}}
                    <svg
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='currentColor'
                      stroke-width='2'
                    >
                      <line x1='1' y1='1' x2='23' y2='23' />
                      <path d='M9 18V5l12-2v13' />
                      <circle cx='6' cy='18' r='3' />
                      <circle cx='18' cy='16' r='3' />
                    </svg>
                    OFF
                  {{/if}}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <nav class='builder-navigation'>
        <Button
          class='nav-tab {{if (eq this.currentTab "songInfo") "active" ""}}'
          {{on 'click' (fn this.switchTab 'songInfo')}}
        >
          <svg
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            stroke-width='2'
          >
            <path
              d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'
            />
            <polyline points='14,2 14,8 20,8' />
            <line x1='16' y1='13' x2='8' y2='13' />
            <line x1='16' y1='17' x2='8' y2='17' />
            <polyline points='10,9 9,9 8,9' />
          </svg>
          Song Info
        </Button>

        <Button
          class='nav-tab {{if (eq this.currentTab "arrangement") "active" ""}}'
          {{on 'click' (fn this.switchTab 'arrangement')}}
        >
          <svg
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            stroke-width='2'
          >
            <rect x='2' y='3' width='20' height='14' rx='2' ry='2' />
            <line x1='8' y1='21' x2='16' y2='21' />
            <line x1='12' y1='17' x2='12' y2='21' />
          </svg>
          Arrangement
        </Button>

        <Button
          class='nav-tab {{if (eq this.currentTab "tracks") "active" ""}}'
          {{on 'click' (fn this.switchTab 'tracks')}}
        >
          <svg
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            stroke-width='2'
          >
            <rect x='3' y='4' width='6' height='16' />
            <rect x='11' y='2' width='6' height='16' />
          </svg>
          Tracks
        </Button>

        <Button
          class='nav-tab {{if (eq this.currentTab "mix") "active" ""}}'
          {{on 'click' (fn this.switchTab 'mix')}}
        >
          <svg
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            stroke-width='2'
          >
            <path d='M4 21v-7' />
            <path d='M4 10V3' />
            <path d='M12 21v-9' />
            <path d='M12 8V3' />
            <path d='M20 21v-5' />
            <path d='M20 12V3' />
            <line x1='1' y1='14' x2='7' y2='14' />
            <line x1='9' y1='12' x2='15' y2='12' />
            <line x1='17' y1='16' x2='23' y2='16' />
          </svg>
          Mix
        </Button>

        <Button
          class='nav-tab {{if (eq this.currentTab "lyrics") "active" ""}}'
          {{on 'click' (fn this.switchTab 'lyrics')}}
        >
          <svg
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            stroke-width='2'
          >
            <path
              d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'
            />
            <polyline points='14,2 14,8 20,8' />
            <line x1='16' y1='13' x2='8' y2='13' />
            <line x1='16' y1='17' x2='8' y2='17' />
          </svg>
          Lyrics
        </Button>
      </nav>

      {{#if (eq this.currentTab 'songInfo')}}
        <section class='builder-section song-info-section'>
          <div class='section-header'>
            <h2>Song Information</h2>
            <p>Basic song details and metadata</p>
          </div>

          <div class='song-info-grid'>
            <div class='info-card'>
              <h3>Basic Details</h3>
              <div class='field-row'>
                <label>Song Title</label>
                <div class='field-display'>{{if
                    @model.songTitle
                    @model.songTitle
                    'Untitled Song'
                  }}</div>
              </div>
              <div class='field-row'>
                <label>Artist</label>
                <div class='field-display'>{{if
                    @model.artist
                    @model.artist
                    'Unknown Artist'
                  }}</div>
              </div>
              <div class='field-row'>
                <label>Genre</label>
                <div class='field-display'>{{if
                    @model.genre
                    @model.genre
                    'Pop'
                  }}</div>
              </div>
              <div class='field-row'>
                <label>Key</label>
                <div class='field-display'>{{if
                    @model.key
                    @model.key
                    'C Major'
                  }}</div>
              </div>
              <div class='field-row'>
                <label>Tempo</label>
                <div class='field-display'>{{if @model.tempo @model.tempo 120}}
                  BPM</div>
              </div>
            </div>

            <div class='info-card'>
              <h3>Description</h3>
              <div class='description-display'>
                {{if
                  @model.description
                  @model.description
                  'Add a description for your song...'
                }}
              </div>
            </div>
          </div>
        </section>
      {{/if}}

      {{#if (eq this.currentTab 'arrangement')}}
        <section class='builder-section arrangement-section'>
          <div class='section-header'>
            <h2>Song Arrangement</h2>
            <p>Structure your song sections and flow</p>
          </div>

          {{#if (gt @model.sections.length 0)}}
            <div class='arrangement-timeline'>
              <div class='sections-container'>
                <@fields.sections @format='embedded' />
              </div>
            </div>
          {{else}}
            <div class='empty-arrangement'>
              <svg
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <rect x='2' y='3' width='20' height='14' rx='2' ry='2' />
                <line x1='8' y1='21' x2='16' y2='21' />
                <line x1='12' y1='17' x2='12' y2='21' />
              </svg>
              <h3>No Arrangement</h3>
              <p>Add sections to build your song structure</p>
            </div>
          {{/if}}
        </section>
      {{/if}}

      {{#if (eq this.currentTab 'tracks')}}
        <section class='builder-section tracks-section'>
          <div class='section-header'>
            <h2>Tracks & Instrumentation</h2>
            <p>Manage individual instrument tracks</p>
          </div>

          {{#if (gt @model.tracks.length 0)}}
            <div class='tracks-mixer'>
              <div class='tracks-container'>
                <@fields.tracks @format='embedded' />
              </div>
            </div>
          {{else}}
            <div class='empty-tracks'>
              <svg
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <rect x='3' y='4' width='6' height='16' />
                <rect x='11' y='2' width='6' height='16' />
              </svg>
              <h3>No Tracks</h3>
              <p>Add instrument tracks to start building your song</p>
            </div>
          {{/if}}
        </section>
      {{/if}}

      {{#if (eq this.currentTab 'mix')}}
        <section class='builder-section mix-section'>
          <div class='section-header'>
            <h2>Mix & Master</h2>
            <p>Final mix controls and overall song balance</p>
          </div>

          <div class='mix-console'>
            <div class='master-section'>
              <h3>Master Bus</h3>
              <div class='master-controls'>
                <div class='master-fader'>
                  <label for='master-volume-fader'>Master Volume</label>
                  <input
                    id='master-volume-fader'
                    type='range'
                    min='0'
                    max='100'
                    value={{if @model.masterVolume @model.masterVolume 85}}
                    class='volume-fader'
                  />
                  <span class='fader-value'>{{if
                      @model.masterVolume
                      @model.masterVolume
                      85
                    }}</span>
                </div>
              </div>
            </div>

            <div class='mix-info'>
              <div class='mix-stats'>
                <div class='stat-item'>
                  <label>Total Duration</label>
                  <span
                    class='stat-value'
                  >{{this.formattedTotalDuration}}</span>
                </div>
                <div class='stat-item'>
                  <label>Track Count</label>
                  <span class='stat-value'>{{if
                      @model.tracks.length
                      @model.tracks.length
                      0
                    }}</span>
                </div>
                <div class='stat-item'>
                  <label>Sections</label>
                  <span class='stat-value'>{{if
                      @model.sections.length
                      @model.sections.length
                      0
                    }}</span>
                </div>
              </div>
            </div>
          </div>
        </section>
      {{/if}}

      {{#if (eq this.currentTab 'lyrics')}}
        <section class='builder-section lyrics-section'>
          <div class='section-header'>
            <h2>Synchronized Lyrics</h2>
            <p>Follow along with real-time lyric highlighting during playback</p>
          </div>

          {{#if (gt this.synchronizedLyrics.length 0)}}
            <div class='lyrics-viewer'>
              {{#each this.synchronizedLyrics as |section|}}
                <div class='lyric-section'>
                  <h4 class='lyric-section-title'>{{section.sectionName}}</h4>
                  <div class='lyric-lines'>
                    {{#each section.lines as |line|}}
                      <div
                        class='lyric-line
                          {{if line.isCurrent "current-line"}}
                          {{if line.isInCurrentSection "in-current-section"}}'
                      >
                        {{line.text}}
                      </div>
                    {{/each}}
                  </div>
                </div>
              {{/each}}
            </div>
          {{else}}
            <div class='empty-lyrics'>
              <svg
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <path
                  d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'
                />
                <polyline points='14,2 14,8 20,8' />
                <line x1='16' y1='13' x2='8' y2='13' />
                <line x1='16' y1='17' x2='8' y2='17' />
              </svg>
              <h3>No Lyrics</h3>
              <p>Add lyrics to your song sections to see synchronized playback</p>
            </div>
          {{/if}}
        </section>
      {{/if}}
    </div>

    <style scoped>
      /* ¹³ Professional Song Builder styles */
      .song-builder {
        background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
        min-height: 100vh;
        font-family:
          'Inter',
          -apple-system,
          sans-serif;
        color: white;
      }

      /* Professional Header */
      .builder-header {
        background: linear-gradient(135deg, #0f172a 0%, #374151 100%);
        border-bottom: 2px solid #4b5563;
        padding: 1.5rem 2rem;
      }

      .header-content {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 2rem;
      }

      .project-info {
        flex: 1;
      }

      .builder-title {
        font-size: 1.75rem;
        font-weight: 700;
        margin: 0 0 0.25rem 0;
        display: flex;
        align-items: center;
        gap: 0.75rem;
        background: linear-gradient(135deg, #60a5fa, #a78bfa);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
      }

      .title-icon {
        width: 28px;
        height: 28px;
        color: #60a5fa;
      }

      .project-subtitle {
        font-size: 1rem;
        color: #94a3b8;
        margin: 0;
      }

      /* Transport Controls */
      .transport-section {
        display: flex;
        align-items: center;
        gap: 2rem;
        flex: 1;
        justify-content: center;
      }

      .playback-controls {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }

      .transport-btn {
        width: 48px;
        height: 48px;
        border-radius: 50%;
        border: 2px solid #475569;
        background: transparent;
        color: #94a3b8;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .transport-btn:hover {
        border-color: #60a5fa;
        color: #60a5fa;
        background: rgba(96, 165, 250, 0.1);
      }

      .transport-btn.play-btn {
        width: 56px;
        height: 56px;
        border-width: 3px;
      }

      .transport-btn.play-btn.playing {
        background: #10b981;
        border-color: #10b981;
        color: white;
      }

      .transport-btn svg {
        width: 20px;
        height: 20px;
      }

      .timeline-section {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.5rem;
        min-width: 200px;
      }

      .time-display {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        font-family: 'JetBrains Mono', monospace;
        font-size: 0.875rem;
        color: #e2e8f0;
      }

      .time-separator {
        color: #64748b;
      }

      .current-section-display {
        font-size: 0.75rem;
        color: #10b981;
        font-weight: 600;
        text-transform: capitalize;
        background: rgba(16, 185, 129, 0.1);
        padding: 0.25rem 0.75rem;
        border-radius: 6px;
        border: 1px solid rgba(16, 185, 129, 0.2);
      }

      /* ⁶⁷ Live lyric display in transport */
      .current-lyric-display {
        font-size: 0.875rem;
        color: #60a5fa;
        font-weight: 600;
        text-align: center;
        background: rgba(96, 165, 250, 0.1);
        padding: 0.5rem 1rem;
        border-radius: 8px;
        border: 1px solid rgba(96, 165, 250, 0.2);
        max-width: 300px;
        font-style: italic;
        animation: lyric-glow 2s ease-in-out infinite;
      }

      @keyframes lyric-glow {
        0%,
        100% {
          box-shadow: 0 0 5px rgba(96, 165, 250, 0.3);
        }
        50% {
          box-shadow: 0 0 15px rgba(96, 165, 250, 0.6);
        }
      }

      .progress-timeline {
        width: 100%;
        height: 6px;
        background: #334155;
        border-radius: 3px;
        position: relative;
        cursor: pointer;
      }

      .timeline-track {
        width: 100%;
        height: 100%;
        border-radius: 3px;
        background: linear-gradient(90deg, #475569 0%, #64748b 100%);
        position: relative;
      }

      .playhead {
        position: absolute;
        top: -3px;
        width: 12px;
        height: 12px;
        background: #60a5fa;
        border-radius: 50%;
        transform: translateX(-50%);
        transition: left 0.1s linear;
        box-shadow: 0 0 8px rgba(96, 165, 250, 0.6);
      }

      .key-controls {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        min-width: 150px;
      }

      .control-group {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }

      .control-group label {
        font-size: 0.75rem;
        color: #94a3b8;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .tempo-control {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }

      .tempo-slider {
        flex: 1;
        height: 4px;
        background: #475569;
        border-radius: 2px;
        outline: none;
        -webkit-appearance: none;
      }

      .tempo-slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        width: 16px;
        height: 16px;
        background: #60a5fa;
        border-radius: 50%;
        cursor: pointer;
        box-shadow: 0 2px 4px rgba(96, 165, 250, 0.3);
      }

      .tempo-value {
        font-size: 0.75rem;
        color: #e2e8f0;
        font-weight: 600;
        min-width: 60px;
        text-align: right;
        font-family: 'JetBrains Mono', monospace;
      }

      .key-select {
        background: #374151;
        border: 1px solid #4b5563;
        color: white;
        padding: 0.375rem 0.75rem;
        border-radius: 6px;
        font-size: 0.875rem;
        font-family: inherit;
        cursor: pointer;
      }

      .key-select:focus {
        outline: none;
        border-color: #60a5fa;
        box-shadow: 0 0 0 2px rgba(96, 165, 250, 0.2);
      }

      /* ⁸¹ Melody toggle button styling */
      .melody-toggle {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        padding: 0.375rem 0.75rem;
        border-radius: 6px;
        font-size: 0.75rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s ease;
        border: 1px solid;
        min-height: 32px;
        justify-content: center;
      }

      .melody-toggle.enabled {
        background: #3b82f6;
        border-color: #2563eb;
        color: white;
      }

      .melody-toggle.enabled:hover {
        background: #2563eb;
        transform: translateY(-1px);
      }

      .melody-toggle.disabled {
        background: #374151;
        border-color: #4b5563;
        color: #9ca3af;
      }

      .melody-toggle.disabled:hover {
        background: #4b5563;
        color: #d1d5db;
      }

      .melody-toggle svg {
        width: 14px;
        height: 14px;
      }

      /* AI Generation Panel */
      .ai-generation-panel {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 1rem;
      }

      .ai-generate-btn {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 1rem 2rem;
        background: linear-gradient(135deg, #3b82f6, #6366f1);
        color: white;
        border: none;
        border-radius: 12px;
        font-size: 1rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.3s ease;
        min-width: 200px;
        justify-content: center;
      }

      .ai-generate-btn:hover:not(:disabled) {
        background: linear-gradient(135deg, #2563eb, #4f46e5);
        transform: translateY(-2px);
        box-shadow: 0 8px 24px rgba(59, 130, 246, 0.4);
      }

      .ai-generate-btn:disabled {
        opacity: 0.7;
        cursor: not-allowed;
      }

      .ai-generate-btn.generating {
        background: linear-gradient(135deg, #059669, #10b981);
      }

      .ai-generate-btn svg {
        width: 20px;
        height: 20px;
      }

      .loading-spinner {
        width: 16px;
        height: 16px;
        border: 2px solid rgba(255, 255, 255, 0.3);
        border-top: 2px solid white;
        border-radius: 50%;
        animation: spin 1s linear infinite;
      }

      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }

      .generation-progress {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        align-items: flex-end;
        min-width: 200px;
      }

      .progress-bar {
        width: 100%;
        height: 6px;
        background: rgba(255, 255, 255, 0.2);
        border-radius: 3px;
        overflow: hidden;
      }

      .progress-fill {
        height: 100%;
        background: linear-gradient(90deg, #10b981, #34d399);
        border-radius: 3px;
        transition: width 0.3s ease;
      }

      .progress-text {
        font-size: 0.875rem;
        color: #cbd5e1;
        font-style: italic;
      }

      .ai-badge {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        background: linear-gradient(135deg, #10b981, #34d399);
        color: white;
        padding: 0.5rem 1rem;
        border-radius: 8px;
        font-size: 0.875rem;
        font-weight: 600;
        animation: ai-pulse 2s ease-in-out infinite;
      }

      .ai-badge svg {
        width: 16px;
        height: 16px;
      }

      @keyframes ai-pulse {
        0%,
        100% {
          opacity: 1;
          transform: scale(1);
        }
        50% {
          opacity: 0.9;
          transform: scale(1.02);
        }
      }

      /* Professional Navigation */
      .builder-navigation {
        background: #1e293b;
        border-bottom: 2px solid #374151;
        padding: 0 2rem;
        display: flex;
        gap: 0;
      }

      .nav-tab {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 1rem 1.5rem;
        border: none;
        background: transparent;
        color: #94a3b8;
        font-size: 0.875rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s ease;
        white-space: nowrap;
        border-bottom: 3px solid transparent;
        position: relative;
      }

      .nav-tab:hover {
        background: rgba(148, 163, 184, 0.1);
        color: #e2e8f0;
      }

      .nav-tab.active {
        background: rgba(59, 130, 246, 0.1);
        color: #60a5fa;
        border-bottom-color: #60a5fa;
      }

      .nav-tab svg {
        width: 18px;
        height: 18px;
      }

      /* Professional Sections */
      .builder-section {
        background: #1e293b;
        padding: 2rem;
        min-height: 400px;
      }

      .section-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 2rem;
        padding-bottom: 1rem;
        border-bottom: 1px solid #374151;
      }

      .section-header h2 {
        font-size: 1.5rem;
        font-weight: 700;
        color: #e2e8f0;
        margin: 0;
        background: linear-gradient(135deg, #60a5fa, #a78bfa);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
      }

      .section-header p {
        font-size: 0.875rem;
        color: #94a3b8;
        margin: 0.25rem 0 0 0;
      }

      .add-section-btn,
      .add-track-btn {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 1rem;
        background: #10b981;
        border: none;
        color: white;
        border-radius: 8px;
        font-size: 0.875rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .add-section-btn:hover,
      .add-track-btn:hover {
        background: #059669;
        transform: translateY(-1px);
      }

      .add-section-btn svg,
      .add-track-btn svg {
        width: 16px;
        height: 16px;
      }

      /* Song Info Section */
      .song-info-grid {
        display: grid;
        grid-template-columns: 1fr 2fr;
        gap: 2rem;
        max-width: 1200px;
        margin: 0 auto;
      }

      .info-card {
        background: #334155;
        border: 1px solid #475569;
        border-radius: 12px;
        padding: 1.5rem;
      }

      .info-card h3 {
        font-size: 1.125rem;
        font-weight: 700;
        color: #e2e8f0;
        margin: 0 0 1rem 0;
        background: linear-gradient(135deg, #60a5fa, #a78bfa);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
      }

      .field-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 0.75rem;
        padding-bottom: 0.75rem;
        border-bottom: 1px solid #475569;
      }

      .field-row:last-child {
        margin-bottom: 0;
        border-bottom: none;
        padding-bottom: 0;
      }

      .field-row label {
        font-size: 0.875rem;
        color: #94a3b8;
        font-weight: 600;
      }

      .field-display {
        font-size: 0.875rem;
        color: #e2e8f0;
        font-weight: 600;
        background: #475569;
        padding: 0.5rem 0.75rem;
        border-radius: 6px;
        border: 1px solid #64748b;
        min-width: 120px;
        text-align: right;
      }

      .description-display {
        background: #475569;
        border: 1px solid #64748b;
        border-radius: 8px;
        padding: 1rem;
        font-size: 0.875rem;
        color: #e2e8f0;
        line-height: 1.6;
        min-height: 120px;
      }

      /* Arrangement Section */
      .arrangement-timeline {
        max-width: 1000px;
        margin: 0 auto;
      }

      .sections-container > .containsMany-field {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }

      .empty-arrangement,
      .empty-tracks {
        text-align: center;
        padding: 3rem;
        color: #94a3b8;
        max-width: 400px;
        margin: 0 auto;
      }

      .empty-arrangement svg,
      .empty-tracks svg {
        width: 64px;
        height: 64px;
        margin: 0 auto 1rem auto;
        color: #64748b;
      }

      .empty-arrangement h3,
      .empty-tracks h3 {
        font-size: 1.25rem;
        font-weight: 600;
        margin: 0 0 0.5rem 0;
        color: #e2e8f0;
      }

      .empty-arrangement p,
      .empty-tracks p {
        font-size: 1rem;
        margin: 0;
        line-height: 1.5;
      }

      /* Tracks Section */
      .tracks-mixer {
        max-width: 1200px;
        margin: 0 auto;
      }

      .tracks-container > .containsMany-field {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        gap: 1rem;
      }

      /* Mix Section */
      .mix-console {
        max-width: 800px;
        margin: 0 auto;
        display: grid;
        grid-template-columns: 1fr 2fr;
        gap: 2rem;
      }

      .master-section {
        background: #334155;
        border: 1px solid #475569;
        border-radius: 12px;
        padding: 1.5rem;
      }

      .master-section h3 {
        font-size: 1.125rem;
        font-weight: 700;
        color: #e2e8f0;
        margin: 0 0 1rem 0;
        text-align: center;
      }

      .master-fader {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.5rem;
      }

      .master-fader label {
        font-size: 0.75rem;
        color: #94a3b8;
        font-weight: 600;
        text-transform: uppercase;
      }

      .volume-fader {
        width: 120px;
        height: 6px;
        background: #475569;
        border-radius: 3px;
        outline: none;
        -webkit-appearance: none;
      }

      .volume-fader::-webkit-slider-thumb {
        -webkit-appearance: none;
        width: 20px;
        height: 20px;
        background: #10b981;
        border-radius: 50%;
        cursor: pointer;
        box-shadow: 0 2px 6px rgba(16, 185, 129, 0.3);
      }

      .fader-value {
        font-size: 0.875rem;
        color: #e2e8f0;
        font-weight: 600;
        font-family: 'JetBrains Mono', monospace;
      }

      .mix-info {
        background: #334155;
        border: 1px solid #475569;
        border-radius: 12px;
        padding: 1.5rem;
      }

      .mix-stats {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 1rem;
      }

      .stat-item {
        text-align: center;
      }

      .stat-item label {
        display: block;
        font-size: 0.75rem;
        color: #94a3b8;
        font-weight: 600;
        margin-bottom: 0.5rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .stat-value {
        font-size: 1.5rem;
        color: #60a5fa;
        font-weight: 700;
        font-family: 'JetBrains Mono', monospace;
      }

      /* ⁶⁸ Lyrics Section Styles */
      .lyrics-viewer {
        max-width: 800px;
        margin: 0 auto;
        background: #334155;
        border-radius: 12px;
        padding: 2rem;
        border: 1px solid #475569;
      }

      .lyric-section {
        margin-bottom: 2rem;
        padding: 1rem;
        border-radius: 8px;
        background: #475569;
        border: 1px solid #64748b;
        transition: all 0.3s ease;
      }

      .lyric-section.current-section {
        background: rgba(16, 185, 129, 0.1);
        border-color: #10b981;
        box-shadow: 0 0 20px rgba(16, 185, 129, 0.2);
      }

      .lyric-section-title {
        font-size: 1rem;
        font-weight: 700;
        color: #e2e8f0;
        margin: 0 0 1rem 0;
        text-transform: capitalize;
        text-align: center;
      }

      .lyric-section.current-section .lyric-section-title {
        color: #10b981;
      }

      .lyric-lines {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }

      .lyric-line {
        padding: 0.75rem 1rem;
        background: #64748b;
        border-radius: 6px;
        color: #cbd5e1;
        font-size: 1rem;
        line-height: 1.5;
        transition: all 0.3s ease;
        border: 1px solid transparent;
      }

      .lyric-line.in-current-section {
        background: #475569;
        color: #e2e8f0;
      }

      .lyric-line.current-line {
        background: linear-gradient(135deg, #60a5fa, #3b82f6);
        color: white;
        font-weight: 600;
        transform: scale(1.02);
        border-color: #60a5fa;
        box-shadow: 0 4px 20px rgba(96, 165, 250, 0.4);
        animation: pulse-current 2s ease-in-out infinite;
      }

      @keyframes pulse-current {
        0%,
        100% {
          box-shadow: 0 4px 20px rgba(96, 165, 250, 0.4);
        }
        50% {
          box-shadow: 0 6px 30px rgba(96, 165, 250, 0.7);
        }
      }

      .empty-lyrics {
        text-align: center;
        padding: 3rem;
        color: #94a3b8;
        max-width: 400px;
        margin: 0 auto;
      }

      .empty-lyrics svg {
        width: 64px;
        height: 64px;
        margin: 0 auto 1rem auto;
        color: #64748b;
      }

      .empty-lyrics h3 {
        font-size: 1.25rem;
        font-weight: 600;
        margin: 0 0 0.5rem 0;
        color: #e2e8f0;
      }

      .empty-lyrics p {
        font-size: 1rem;
        margin: 0;
        line-height: 1.5;
      }

      /* Structure Section */
      .structure-editor {
        max-width: 800px;
        margin: 0 auto;
      }

      .sections-list {
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
      }

      .section-editor {
        background: white;
        border-radius: 12px;
        border: 1px solid #e5e7eb;
        overflow: hidden;
      }

      .section-editor .section-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 1rem 1.5rem;
        background: #f8fafc;
        border-bottom: 1px solid #e5e7eb;
        margin: 0;
      }

      .section-title {
        font-size: 1rem;
        font-weight: 700;
        color: #1e293b;
        margin: 0;
        text-transform: capitalize;
      }

      .regen-btn {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        padding: 0.375rem 0.75rem;
        background: #f3f4f6;
        border: 1px solid #d1d5db;
        color: #374151;
        border-radius: 6px;
        font-size: 0.75rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .regen-btn:hover {
        background: #3b82f6;
        border-color: #3b82f6;
        color: white;
      }

      .regen-btn svg {
        width: 14px;
        height: 14px;
      }

      .section-content {
        padding: 1.5rem;
        font-size: 0.875rem;
        color: #1e293b;
        line-height: 1.6;
        white-space: pre-wrap;
      }

      /* Parameters Section */
      .parameters-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
        gap: 2rem;
        max-width: 1000px;
        margin: 0 auto;
      }

      .param-card {
        background: white;
        border-radius: 16px;
        padding: 1.5rem;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
        border: 1px solid #e5e7eb;
      }

      .param-card h4 {
        font-size: 1.125rem;
        font-weight: 700;
        color: #1e293b;
        margin: 0 0 1rem 0;
      }

      .param-controls {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }

      .control-group {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
      }

      .control-group label {
        font-size: 0.75rem;
        font-weight: 600;
        color: #64748b;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .param-display {
        font-size: 0.875rem;
        color: #1e293b;
        font-weight: 600;
        padding: 0.75rem;
        background: #f8fafc;
        border-radius: 8px;
        border: 1px solid #e2e8f0;
      }

      .energy-display {
        display: flex;
        align-items: center;
        gap: 0.75rem;
      }

      .energy-display .energy-bar {
        flex: 1;
        height: 20px;
        background: #e0f2fe;
        border-radius: 10px;
        overflow: hidden;
        position: relative;
      }

      .energy-display .energy-fill {
        height: 100%;
        background: linear-gradient(90deg, #0ea5e9, #3b82f6);
        border-radius: 10px;
        transition: width 0.3s ease;
      }

      .energy-value {
        font-size: 0.75rem;
        font-weight: 700;
        color: #0369a1;
        min-width: 30px;
      }

      /* Empty States */
      .empty-structure,
      .empty-parameters {
        text-align: center;
        padding: 3rem;
        color: #64748b;
        max-width: 400px;
        margin: 0 auto;
      }

      .empty-structure svg,
      .empty-parameters svg {
        width: 64px;
        height: 64px;
        margin: 0 auto 1rem auto;
        color: #cbd5e1;
      }

      .empty-structure h3,
      .empty-parameters h3 {
        font-size: 1.25rem;
        font-weight: 600;
        margin: 0 0 0.5rem 0;
      }

      .empty-structure p,
      .empty-parameters p {
        font-size: 1rem;
        margin: 0;
        line-height: 1.5;
      }

      /* AI Features Panel */
      .ai-features-panel {
        background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%);
        border: 2px solid #0ea5e9;
        border-radius: 16px;
        padding: 2rem;
        margin: 2rem;
      }

      .ai-features-panel h3 {
        font-size: 1.375rem;
        font-weight: 700;
        color: #0c4a6e;
        margin: 0 0 1.5rem 0;
        text-align: center;
      }

      .features-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 1.5rem;
      }

      .feature-card {
        background: white;
        border-radius: 12px;
        padding: 1.5rem;
        text-align: center;
        border: 1px solid #bae6fd;
        transition: all 0.2s ease;
      }

      .feature-card:hover {
        transform: translateY(-2px);
        box-shadow: 0 8px 24px rgba(14, 165, 233, 0.15);
      }

      .feature-card svg {
        width: 48px;
        height: 48px;
        color: #0ea5e9;
        margin-bottom: 1rem;
      }

      .feature-card h4 {
        font-size: 1rem;
        font-weight: 700;
        color: #0c4a6e;
        margin: 0 0 0.5rem 0;
      }

      .feature-card p {
        font-size: 0.875rem;
        color: #0369a1;
        margin: 0;
        line-height: 1.5;
      }

      /* Responsive Design */
      @media (max-width: 768px) {
        .builder-header {
          padding: 1rem;
        }

        .header-content {
          flex-direction: column;
          align-items: stretch;
          gap: 1rem;
        }

        .transport-section {
          gap: 1rem;
        }

        .key-controls {
          min-width: auto;
        }

        .builder-navigation {
          padding: 0 1rem;
          overflow-x: auto;
        }

        .nav-tab {
          padding: 0.75rem 1rem;
        }

        .builder-section {
          padding: 1.5rem 1rem;
        }

        .song-info-grid {
          grid-template-columns: 1fr;
        }

        .mix-console {
          grid-template-columns: 1fr;
          gap: 1rem;
        }

        .tracks-container > .containsMany-field {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </template>
}

// ¹⁴ Song Builder Card Definition - Professional song creation tool
export class SongBuilderCard extends CardDef {
  static displayName = 'Song Builder';
  static icon = MusicIcon;
  static prefersWideFormat = true;

  // ¹⁵ Basic song information
  @field songTitle = contains(StringField);
  @field artist = contains(StringField);
  @field description = contains(TextAreaField);
  @field genre = contains(StringField);
  @field key = contains(StringField);
  @field tempo = contains(NumberField);
  @field timeSignature = contains(StringField);

  // ¹⁶ Song structure and arrangement
  @field sections = containsMany(SongSectionField);
  @field tracks = containsMany(TrackField);
  @field masterVolume = contains(NumberField);
  // Duration calculated automatically from sections

  @field title = contains(StringField, {
    computeVia: function (this: SongBuilderCard) {
      try {
        return this.songTitle ?? 'Song Builder';
      } catch (e) {
        console.error('SongBuilderCard: Error computing title', e);
        return 'Song Builder';
      }
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='song-builder-card'>
        <div class='builder-header'>
          <div class='builder-info'>
            <h3 class='builder-title'>
              <svg
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <path d='M9 18V5l12-2v13' />
                <circle cx='6' cy='18' r='3' />
                <circle cx='18' cy='16' r='3' />
              </svg>
              {{if @model.songTitle @model.songTitle 'Song Builder'}}
            </h3>
            {{#if @model.description}}
              <p class='builder-description'>{{@model.description}}</p>
            {{/if}}
          </div>
        </div>

        <div class='builder-preview'>
          <div class='preview-section'>
            <@fields.sections @format='embedded' />
          </div>
        </div>

        <div class='builder-footer'>
          <div class='builder-features'>
            <span class='feature-tag'>AI Collaboration</span>
            <span class='feature-tag'>Real-time Editing</span>
            <span class='feature-tag'>Professional Output</span>
          </div>
        </div>
      </div>

      <style scoped>
        .song-builder-card {
          background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
          border: 2px solid #e2e8f0;
          border-radius: 16px;
          padding: 1.5rem;
          transition: all 0.3s ease;
        }

        .song-builder-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.1);
          border-color: #3b82f6;
        }

        .builder-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 1.5rem;
          gap: 1rem;
        }

        .builder-info {
          flex: 1;
          min-width: 0;
        }

        .builder-title {
          font-size: 1.25rem;
          font-weight: 700;
          color: #1e293b;
          margin: 0 0 0.5rem 0;
          display: flex;
          align-items: center;
          gap: 0.5rem;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .builder-title svg {
          width: 20px;
          height: 20px;
          color: #3b82f6;
          flex-shrink: 0;
        }

        .builder-description {
          font-size: 0.875rem;
          color: #64748b;
          margin: 0;
          line-height: 1.5;
          overflow: hidden;
          text-overflow: ellipsis;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
        }

        .ai-badge {
          display: flex;
          align-items: center;
          gap: 0.375rem;
          background: linear-gradient(135deg, #10b981, #34d399);
          color: white;
          padding: 0.375rem 0.75rem;
          border-radius: 8px;
          font-size: 0.75rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          white-space: nowrap;
          animation: ai-pulse 2s ease-in-out infinite;
        }

        .ai-badge svg {
          width: 14px;
          height: 14px;
        }

        @keyframes ai-pulse {
          0%,
          100% {
            opacity: 1;
            transform: scale(1);
          }
          50% {
            opacity: 0.9;
            transform: scale(1.02);
          }
        }

        .builder-preview {
          display: flex;
          flex-direction: column;
          gap: 1rem;
          margin-bottom: 1.5rem;
        }

        .preview-section {
          background: white;
          border-radius: 12px;
          overflow: hidden;
          border: 1px solid #e5e7eb;
        }

        .builder-footer {
          border-top: 1px solid #e2e8f0;
          padding-top: 1rem;
        }

        .builder-features {
          display: flex;
          gap: 0.5rem;
          flex-wrap: wrap;
          justify-content: center;
        }

        .feature-tag {
          background: #eff6ff;
          color: #1e40af;
          padding: 0.25rem 0.5rem;
          border-radius: 6px;
          font-size: 0.625rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          border: 1px solid #dbeafe;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    <template>
      <div class='fitted-container'>
        <div class='badge-format'>
          <div class='badge-content'>
            <div class='badge-icon'>
              <div class='ai-brain'>
                <div class='brain-core'></div>
                <div class='brain-pulse'></div>
                <div class='brain-connections'>
                  <div class='connection'></div>
                  <div class='connection'></div>
                  <div class='connection'></div>
                </div>
              </div>
            </div>
            <div class='badge-info'>
              <div class='badge-title'>Song Builder</div>
              <div class='badge-stats'>{{if
                  @model.sections.length
                  @model.sections.length
                  7
                }}
                sections</div>
            </div>
          </div>
        </div>

        <div class='strip-format'>
          <div class='strip-content'>
            <div class='strip-visual'>
              <div class='ai-processor'>
                <div class='processor-core'>
                  <div class='core-dot active'></div>
                  <div class='core-dot'></div>
                  <div class='core-dot active'></div>
                </div>
                <div class='processor-waves'>
                  <div class='wave'></div>
                  <div class='wave'></div>
                  <div class='wave'></div>
                </div>
              </div>
            </div>
            <div class='strip-info'>
              <div class='strip-title'>Song Builder</div>
              <div class='strip-description'>{{if
                  @model.songTitle
                  @model.songTitle
                  'Composition Studio'
                }}
                •
                {{if @model.tempo @model.tempo 124}}
                BPM</div>
            </div>
            <div class='strip-badge'>
              <div class='ai-indicator'></div>
              STUDIO
            </div>
          </div>
        </div>

        <div class='tile-format'>
          <div class='tile-header'>
            <div class='tile-visual'>
              <div class='composition-studio'>
                <div class='studio-brain'>
                  <div class='neural-network'>
                    <div class='neuron'></div>
                    <div class='neuron active'></div>
                    <div class='neuron'></div>
                    <div class='neuron active'></div>
                  </div>
                  <div class='data-streams'>
                    <div class='stream'></div>
                    <div class='stream'></div>
                    <div class='stream'></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div class='tile-content'>
            <h3 class='tile-title'>Song Builder</h3>
            <div class='tile-specs'>
              <div class='spec-row'>
                <span class='spec-label'>Song:</span>
                <span class='spec-value'>{{if
                    @model.songTitle
                    @model.songTitle
                    'Untitled'
                  }}</span>
              </div>
              <div class='spec-row'>
                <span class='spec-label'>Sections:</span>
                <span class='spec-value'>{{@model.sections.length}}</span>
              </div>
              <div class='spec-row'>
                <span class='spec-label'>Tracks:</span>
                <span class='spec-value'>{{@model.tracks.length}}</span>
              </div>
            </div>
            <div class='tile-features'>
              <div class='feature-tag'>Compose</div>
              <div class='feature-tag'>Lyrics</div>
              <div class='feature-tag'>Multi-track</div>
            </div>
          </div>
        </div>

        <div class='card-format'>
          <div class='card-header'>
            <div class='card-info'>
              <h3 class='card-title'>Song Builder Studio</h3>
              <p class='card-description'>Professional composition workspace
                with real-time collaboration and advanced arrangement tools</p>
            </div>
            <div class='card-visual'>
              <div class='ai-studio'>
                <div class='studio-display'>
                  <div class='display-line'>
                    <span class='param-label'>PROJECT</span>
                    <span class='param-value'>{{if
                        @model.songTitle
                        @model.songTitle
                        'NEW'
                      }}</span>
                  </div>
                  <div class='display-line'>
                    <span class='param-label'>TEMPO</span>
                    <span class='param-value'>{{if
                        @model.tempo
                        @model.tempo
                        124
                      }}</span>
                  </div>
                </div>
                <div class='ai-indicators'>
                  <div class='ai-led processing'></div>
                  <div class='ai-led ready'></div>
                  <div class='ai-led standby'></div>
                </div>
              </div>
            </div>
          </div>
          <div class='card-stats'>
            <div class='stats-grid'>
              <div class='stat-group'>
                <div class='stat-number'>{{if
                    @model.sections.length
                    @model.sections.length
                    7
                  }}</div>
                <div class='stat-label'>Sections</div>
              </div>
              <div class='stat-group'>
                <div class='stat-number'>{{if
                    @model.tracks.length
                    @model.tracks.length
                    8
                  }}</div>
                <div class='stat-label'>Tracks</div>
              </div>
            </div>
          </div>
          <div class='card-features'>
            <div class='features-label'>Studio Capabilities:</div>
            <div class='feature-list'>
              <div class='feature-pill'>Lyric Editor</div>
              <div class='feature-pill'>Chord Progression</div>
              <div class='feature-pill'>Arrangement</div>
              <div class='feature-pill'>Real-time Sync</div>
            </div>
          </div>
        </div>
      </div>

      <style scoped>
        .fitted-container {
          container-type: size;
          width: 100%;
          height: 100%;
          font-family:
            'Inter',
            -apple-system,
            sans-serif;
        }

        /* Hide all by default */
        .badge-format,
        .strip-format,
        .tile-format,
        .card-format {
          display: none;
          width: 100%;
          height: 100%;
          padding: clamp(0.1875rem, 2%, 0.625rem);
          box-sizing: border-box;
          background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
          border-radius: 12px;
          overflow: hidden;
        }

        /* Badge Format (≤150px width, ≤169px height) */
        @container (max-width: 150px) and (max-height: 169px) {
          .badge-format {
            display: flex;
            align-items: center;
          }
        }

        .badge-content {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          width: 100%;
        }

        .badge-icon {
          width: 24px;
          height: 24px;
          flex-shrink: 0;
          position: relative;
        }

        .ai-brain {
          width: 100%;
          height: 100%;
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .brain-core {
          width: 12px;
          height: 12px;
          background: linear-gradient(135deg, #8b5cf6 0%, #a855f7 100%);
          border-radius: 50%;
          animation: brain-pulse 2s ease-in-out infinite;
        }

        .brain-pulse {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 8px;
          height: 8px;
          background: rgba(139, 92, 246, 0.4);
          border-radius: 50%;
          animation: pulse-ring 2s ease-in-out infinite;
        }

        .brain-connections {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
        }

        .connection {
          position: absolute;
          width: 2px;
          height: 2px;
          background: #8b5cf6;
          border-radius: 50%;
          animation: connection-blink 3s ease-in-out infinite;
        }

        .connection:nth-child(1) {
          top: 2px;
          left: 4px;
          animation-delay: 0s;
        }

        .connection:nth-child(2) {
          top: 8px;
          right: 2px;
          animation-delay: 0.5s;
        }

        .connection:nth-child(3) {
          bottom: 4px;
          left: 8px;
          animation-delay: 1s;
        }

        @keyframes brain-pulse {
          0%,
          100% {
            opacity: 1;
            transform: scale(1);
          }
          50% {
            opacity: 0.8;
            transform: scale(1.1);
          }
        }

        @keyframes pulse-ring {
          0% {
            opacity: 0.8;
            transform: translate(-50%, -50%) scale(1);
          }
          100% {
            opacity: 0;
            transform: translate(-50%, -50%) scale(2.5);
          }
        }

        @keyframes connection-blink {
          0%,
          70%,
          100% {
            opacity: 0.3;
          }
          35% {
            opacity: 1;
          }
        }

        .badge-info {
          flex: 1;
          min-width: 0;
        }

        .badge-title {
          font-size: 0.75rem;
          font-weight: 700;
          color: #8b5cf6;
          line-height: 1.2;
          margin-bottom: 0.125rem;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .badge-stats {
          font-size: 0.625rem;
          color: rgba(255, 255, 255, 0.7);
          font-family: 'JetBrains Mono', monospace;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        /* Strip Format (151px-399px width, ≤169px height) */
        @container (min-width: 151px) and (max-height: 169px) {
          .strip-format {
            display: flex;
            align-items: center;
          }
        }

        .strip-content {
          display: flex;
          align-items: center;
          gap: 1rem;
          width: 100%;
        }

        .strip-visual {
          flex-shrink: 0;
        }

        .ai-processor {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 3px;
          width: 32px;
          height: 24px;
        }

        .processor-core {
          display: flex;
          gap: 2px;
        }

        .core-dot {
          width: 4px;
          height: 4px;
          background: rgba(139, 92, 246, 0.3);
          border-radius: 50%;
          transition: all 0.3s ease;
        }

        .core-dot.active {
          background: #8b5cf6;
          animation: core-pulse 1.5s ease-in-out infinite;
        }

        @keyframes core-pulse {
          0%,
          100% {
            opacity: 1;
            transform: scale(1);
          }
          50% {
            opacity: 0.6;
            transform: scale(1.3);
          }
        }

        .processor-waves {
          display: flex;
          gap: 1px;
          align-items: flex-end;
        }

        .wave {
          width: 2px;
          background: rgba(139, 92, 246, 0.5);
          border-radius: 1px;
          animation: wave-flow 2s ease-in-out infinite;
        }

        .wave:nth-child(1) {
          height: 8px;
          animation-delay: 0s;
        }

        .wave:nth-child(2) {
          height: 12px;
          animation-delay: 0.3s;
        }

        .wave:nth-child(3) {
          height: 6px;
          animation-delay: 0.6s;
        }

        @keyframes wave-flow {
          0%,
          100% {
            opacity: 0.5;
            transform: scaleY(1);
          }
          50% {
            opacity: 1;
            transform: scaleY(1.4);
          }
        }

        .strip-info {
          flex: 1;
          min-width: 0;
        }

        .strip-title {
          font-size: 0.875rem;
          font-weight: 700;
          color: #8b5cf6;
          line-height: 1.2;
          margin-bottom: 0.25rem;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .strip-description {
          font-size: 0.75rem;
          color: rgba(255, 255, 255, 0.7);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .strip-badge {
          display: flex;
          align-items: center;
          gap: 0.25rem;
          padding: 0.25rem 0.5rem;
          background: rgba(139, 92, 246, 0.2);
          border: 1px solid #8b5cf6;
          border-radius: 6px;
          font-size: 0.625rem;
          font-weight: 700;
          color: #8b5cf6;
          font-family: 'JetBrains Mono', monospace;
          flex-shrink: 0;
        }

        .ai-indicator {
          width: 6px;
          height: 6px;
          background: #8b5cf6;
          border-radius: 50%;
          animation: ai-pulse 1.5s ease-in-out infinite;
        }

        @keyframes ai-pulse {
          0%,
          100% {
            opacity: 1;
            transform: scale(1);
          }
          50% {
            opacity: 0.6;
            transform: scale(1.2);
          }
        }

        /* Tile Format (≤399px width, ≥170px height) */
        @container (max-width: 399px) and (min-height: 170px) {
          .tile-format {
            display: flex;
            flex-direction: column;
          }
        }

        .tile-header {
          position: relative;
          height: 70px;
          background: linear-gradient(135deg, #8b5cf6 0%, #a855f7 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 1rem;
          border-radius: 8px;
          overflow: hidden;
        }

        .composition-studio {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.5rem;
        }

        .studio-brain {
          position: relative;
          width: 48px;
          height: 32px;
        }

        .neural-network {
          display: grid;
          grid-template-columns: repeat(2, 8px);
          grid-template-rows: repeat(2, 8px);
          gap: 4px;
          margin-bottom: 4px;
        }

        .neuron {
          width: 8px;
          height: 8px;
          background: rgba(255, 255, 255, 0.3);
          border-radius: 50%;
          transition: all 0.3s ease;
        }

        .neuron.active {
          background: rgba(255, 255, 255, 0.9);
          box-shadow: 0 0 8px rgba(255, 255, 255, 0.6);
          animation: neuron-fire 2s ease-in-out infinite;
        }

        @keyframes neuron-fire {
          0%,
          100% {
            opacity: 1;
            transform: scale(1);
          }
          50% {
            opacity: 0.7;
            transform: scale(1.2);
          }
        }

        .data-streams {
          display: flex;
          justify-content: space-between;
          width: 100%;
        }

        .stream {
          width: 2px;
          height: 8px;
          background: rgba(255, 255, 255, 0.6);
          border-radius: 1px;
          animation: data-flow 1.8s ease-in-out infinite;
        }

        .stream:nth-child(1) {
          animation-delay: 0s;
        }
        .stream:nth-child(2) {
          animation-delay: 0.3s;
        }
        .stream:nth-child(3) {
          animation-delay: 0.6s;
        }

        @keyframes data-flow {
          0%,
          100% {
            opacity: 0.4;
            transform: scaleY(1);
          }
          50% {
            opacity: 1;
            transform: scaleY(1.5);
          }
        }

        .tile-content {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }

        .tile-title {
          font-size: 1rem;
          font-weight: 700;
          color: #8b5cf6;
          margin: 0;
          line-height: 1.2;
        }

        .tile-specs {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .spec-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .spec-label {
          font-size: 0.75rem;
          color: rgba(255, 255, 255, 0.7);
          font-weight: 500;
        }

        .spec-value {
          font-size: 0.875rem;
          color: #8b5cf6;
          font-weight: 600;
          font-family: 'JetBrains Mono', monospace;
        }

        .tile-features {
          display: flex;
          flex-wrap: wrap;
          gap: 0.375rem;
          margin-top: auto;
        }

        .feature-tag {
          padding: 0.25rem 0.5rem;
          background: rgba(139, 92, 246, 0.2);
          border: 1px solid #8b5cf6;
          color: #8b5cf6;
          font-size: 0.625rem;
          font-weight: 600;
          border-radius: 4px;
          font-family: 'JetBrains Mono', monospace;
        }

        /* Card Format (≥400px width, ≥170px height) */
        @container (min-width: 400px) and (min-height: 170px) {
          .card-format {
            display: flex;
            flex-direction: column;
          }
        }

        .card-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: linear-gradient(135deg, #8b5cf6 0%, #a855f7 100%);
          padding: 1rem;
          border-radius: 8px;
          margin-bottom: 1rem;
        }

        .card-info {
          flex: 1;
        }

        .card-title {
          font-size: 1.25rem;
          font-weight: 700;
          color: white;
          margin: 0 0 0.5rem 0;
          line-height: 1.2;
        }

        .card-description {
          font-size: 0.875rem;
          color: rgba(255, 255, 255, 0.9);
          margin: 0;
          line-height: 1.4;
        }

        .ai-studio {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          padding: 0.75rem;
          background: rgba(15, 23, 42, 0.7);
          backdrop-filter: blur(8px);
          border-radius: 8px;
          min-width: 120px;
        }

        .studio-display {
          background: #0f172a;
          padding: 0.5rem;
          border-radius: 4px;
          border: 1px solid rgba(139, 92, 246, 0.3);
        }

        .display-line {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 0.25rem;
        }

        .display-line:last-child {
          margin-bottom: 0;
        }

        .param-label {
          font-size: 0.625rem;
          color: rgba(255, 255, 255, 0.6);
          font-weight: 600;
        }

        .param-value {
          font-size: 0.75rem;
          color: #8b5cf6;
          font-weight: 700;
          font-family: 'JetBrains Mono', monospace;
        }

        .ai-indicators {
          display: flex;
          justify-content: space-between;
          gap: 0.25rem;
        }

        .ai-led {
          width: 8px;
          height: 8px;
          background: #374151;
          border: 1px solid #8b5cf6;
          border-radius: 50%;
          transition: all 0.3s ease;
        }

        .ai-led.processing {
          background: #8b5cf6;
          box-shadow: 0 0 8px rgba(139, 92, 246, 0.6);
          animation: led-processing 1.5s ease-in-out infinite;
        }

        .ai-led.ready {
          background: #10b981;
          box-shadow: 0 0 4px rgba(16, 185, 129, 0.4);
        }

        .ai-led.standby {
          background: #374151;
        }

        @keyframes led-processing {
          0%,
          100% {
            opacity: 1;
            transform: scale(1);
          }
          50% {
            opacity: 0.6;
            transform: scale(1.2);
          }
        }

        .card-stats {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 1rem;
          margin-bottom: 1rem;
          background: rgba(248, 250, 252, 0.1);
          border-radius: 8px;
          padding: 1rem;
        }

        .stat-group {
          text-align: center;
        }

        .stat-number {
          font-size: 1.5rem;
          font-weight: 700;
          color: #8b5cf6;
          margin-bottom: 0.25rem;
          font-family: 'JetBrains Mono', monospace;
        }

        .stat-label {
          font-size: 0.75rem;
          color: rgba(255, 255, 255, 0.7);
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .card-features {
          margin-top: auto;
        }

        .features-label {
          font-size: 0.75rem;
          color: rgba(255, 255, 255, 0.7);
          font-weight: 600;
          margin-bottom: 0.5rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .feature-list {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
        }

        .feature-pill {
          padding: 0.375rem 0.75rem;
          background: linear-gradient(135deg, #8b5cf6 0%, #a855f7 100%);
          color: white;
          font-size: 0.75rem;
          font-weight: 600;
          border-radius: 6px;
          border: 1px solid rgba(255, 255, 255, 0.1);
        }
      </style>
    </template>
  };

  static isolated = SongBuilderIsolated;
}
