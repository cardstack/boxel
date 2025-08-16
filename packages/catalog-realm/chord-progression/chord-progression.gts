import {
  CardDef,
  FieldDef,
  field,
  contains,
  containsMany,
  Component,
  linksTo,
  linksToMany,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import MusicIcon from '@cardstack/boxel-icons/music';
import { Button } from '@cardstack/boxel-ui/components';
import { gt, eq, add, lt } from '@cardstack/boxel-ui/helpers';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';

export class ChordField extends FieldDef {
  static displayName = 'Chord';
  static icon = MusicIcon;

  @field chordName = contains(StringField); // e.g., "C", "Am", "G7"
  @field chordType = contains(StringField); // e.g., "major", "minor", "dominant7"
  @field rootNote = contains(StringField); // e.g., "C", "A", "G"
  @field quality = contains(StringField); // e.g., "major", "minor", "diminished"

  // Individual note fields - much more user-friendly
  @field note1 = contains(StringField); // First note (root)
  @field note2 = contains(StringField); // Second note
  @field note3 = contains(StringField); // Third note
  @field note4 = contains(StringField); // Fourth note (for 7ths, etc.)
  @field note5 = contains(StringField); // Fifth note (for extended chords)

  // Computed property that combines individual notes into an array
  get notesList() {
    const notes = [
      this.note1,
      this.note2,
      this.note3,
      this.note4,
      this.note5,
    ].filter((note) => note && note.trim() !== ''); // Remove empty notes

    return notes;
  }

  static embedded = class Embedded extends Component<typeof this> {
    get displayNotes() {
      const model = this.args.model;
      if (!model) return [];

      // First try individual note fields (new format)
      const individualNotes = [
        model.note1,
        model.note2,
        model.note3,
        model.note4,
        model.note5,
      ].filter((note) => note && note.trim() !== '');

      if (individualNotes.length > 0) {
        return individualNotes;
      }

      return [];
    }

    <template>
      <div class='chord-field'>
        <div class='chord-symbol'>{{if
            @model.chordName
            @model.chordName
            'Untitled Chord'
          }}</div>
        <div class='chord-details'>
          {{#if @model.quality}}
            <span class='chord-quality'>{{@model.quality}}</span>
          {{/if}}
          {{#if (gt this.displayNotes.length 0)}}
            <div class='chord-notes'>
              {{#each this.displayNotes as |note|}}
                <span class='note'>{{note}}</span>
              {{/each}}
            </div>
          {{else}}
            <div class='no-notes'>
              <span class='note-placeholder'>No notes</span>
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

        .chord-quality {
          font-size: 0.75rem;
          color: #64748b;
          text-transform: capitalize;
          margin-bottom: 0.25rem;
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

        .note-placeholder {
          background: #e5e7eb;
          color: #6b7280;
          padding: 0.125rem 0.375rem;
          border-radius: 12px;
          font-size: 0.625rem;
          font-weight: 600;
          font-style: italic;
        }
      </style>
    </template>
  };
}

export class ChordProgressionField extends FieldDef {
  static displayName = 'Chord Progression';
  static icon = MusicIcon;

  @field progressionName = contains(StringField);
  @field chords = containsMany(ChordField);
  @field key = contains(StringField); // e.g., "C major", "A minor"
  @field timeSignature = contains(StringField); // e.g., "4/4", "3/4"
  @field tempo = contains(NumberField);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='progression-field'>
        <div class='progression-header'>
          <h4 class='progression-name'>{{if
              @model.progressionName
              @model.progressionName
              'Chord Progression'
            }}</h4>
          <div class='progression-meta'>
            {{#if @model.key}}
              <span class='key-signature'>{{@model.key}}</span>
            {{/if}}
            {{#if @model.timeSignature}}
              <span class='time-signature'>{{@model.timeSignature}}</span>
            {{/if}}
          </div>
        </div>

        {{#if (gt @model.chords.length 0)}}
          <div class='chords-container'>
            <@fields.chords @format='embedded' />
          </div>
        {{else}}
          <div class='empty-progression'>
            <p>No chords added yet</p>
          </div>
        {{/if}}
      </div>

      <style scoped>
        .progression-field {
          background: white;
          border: 1px solid #d1d5db;
          border-radius: 12px;
          padding: 1rem;
        }

        .progression-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 1rem;
        }

        .progression-name {
          font-size: 1rem;
          font-weight: 600;
          color: #1f2937;
          margin: 0;
        }

        .progression-meta {
          display: flex;
          gap: 0.5rem;
          align-items: center;
        }

        .key-signature,
        .time-signature {
          background: #f3f4f6;
          color: #374151;
          padding: 0.25rem 0.5rem;
          border-radius: 6px;
          font-size: 0.75rem;
          font-weight: 600;
        }

        .chords-container > .containsMany-field {
          display: flex;
          gap: 0.75rem;
          flex-wrap: wrap;
        }

        .empty-progression {
          text-align: center;
          color: #9ca3af;
          font-style: italic;
          padding: 1rem;
        }
      </style>
    </template>
  };
}

// ¹¹⁷ Interactive Chord Progression Player Component
class ChordProgressionPlayerIsolated extends Component<
  typeof ChordProgressionPlayerCard
> {
  @tracked currentChordIndex = 0;
  @tracked isPlaying = false;
  @tracked playbackTimer: number | null = null;

  // ¹¹⁸ Audio synthesis for chord playback
  audioContext: AudioContext | null = null;
  activeOscillators: OscillatorNode[] = [];

  constructor(owner: any, args: any) {
    super(owner, args);
    this.initializeAudio();
  }

  initializeAudio() {
    try {
      this.audioContext = new (window.AudioContext ||
        (window as any).webkitAudioContext)();
    } catch (e) {
      console.warn('Web Audio API not supported');
    }
  }

  // ¹¹⁹ Note frequency mapping
  noteFrequencies = {
    C: 261.63,
    'C#': 277.18,
    Db: 277.18,
    D: 293.66,
    'D#': 311.13,
    Eb: 311.13,
    E: 329.63,
    F: 349.23,
    'F#': 369.99,
    Gb: 369.99,
    G: 392.0,
    'G#': 415.3,
    Ab: 415.3,
    A: 440.0,
    'A#': 466.16,
    Bb: 466.16,
    B: 493.88,
  };

  // ¹²⁰ Play a chord (multiple notes simultaneously)
  playChord(notes: string[], duration: number = 1.0) {
    if (!this.audioContext || !notes.length) return;

    // Stop any currently playing notes
    this.stopAllNotes();

    const masterGain = this.audioContext.createGain();
    masterGain.connect(this.audioContext.destination);
    masterGain.gain.setValueAtTime(0.1, this.audioContext.currentTime); // Gentle volume

    notes.forEach((note) => {
      const frequency =
        this.noteFrequencies[note as keyof typeof this.noteFrequencies];
      if (!frequency) return;

      const oscillator = this.audioContext!.createOscillator();
      const gainNode = this.audioContext!.createGain();

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(
        frequency,
        this.audioContext!.currentTime,
      );

      // ADSR envelope for pleasant sound
      gainNode.gain.setValueAtTime(0, this.audioContext!.currentTime);
      gainNode.gain.linearRampToValueAtTime(
        0.8,
        this.audioContext!.currentTime + 0.1,
      ); // Attack
      gainNode.gain.exponentialRampToValueAtTime(
        0.6,
        this.audioContext!.currentTime + 0.3,
      ); // Decay
      gainNode.gain.setValueAtTime(
        0.6,
        this.audioContext!.currentTime + duration - 0.2,
      ); // Sustain
      gainNode.gain.exponentialRampToValueAtTime(
        0.01,
        this.audioContext!.currentTime + duration,
      ); // Release

      oscillator.connect(gainNode);
      gainNode.connect(masterGain);

      oscillator.start(this.audioContext!.currentTime);
      oscillator.stop(this.audioContext!.currentTime + duration);

      this.activeOscillators.push(oscillator);
    });
  }

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

  get currentProgression() {
    try {
      return this.args.model?.currentProgression || null;
    } catch (e) {
      console.error('Error accessing current progression:', e);
      return null;
    }
  }

  get progressionChords() {
    try {
      const progression = this.currentProgression;
      const chords = progression?.chordProgression?.chords || [];

      return chords.map((chord) => {
        // Create notes list from individual note fields or parse JSON fallback
        let notesList: string[] = [];

        // Try individual note fields first (new format)
        const individualNotes = [
          chord.note1,
          chord.note2,
          chord.note3,
          chord.note4,
          chord.note5,
        ].filter((note) => note && note.trim() !== '');

        if (individualNotes.length > 0) {
          notesList = individualNotes;
        }

        return {
          chordName: chord.chordName || '?',
          chordType: chord.chordType || 'unknown',
          rootNote: chord.rootNote || '',
          quality: chord.quality || 'unknown',
          notesList: notesList,
        };
      });
    } catch (e) {
      console.error('Error accessing progression chords:', e);
      return [];
    }
  }

  // ¹³⁵ Enhanced helper method with better debugging
  parseChordNotes(notesString: string) {
    try {
      if (!notesString) return [];
      return JSON.parse(notesString);
    } catch (e) {
      console.error('Error parsing chord notes:', e, 'Input:', notesString);
      return [];
    }
  }

  get currentChord() {
    const chords = this.progressionChords;
    return chords[this.currentChordIndex] || null;
  }

  get chordDuration() {
    // Calculate duration based on tempo and time signature
    const tempo = this.currentProgression?.tempo || 120;
    const beatsPerChord = 4; // Each chord lasts 4 beats by default
    return (60 / tempo) * beatsPerChord * 1000; // Convert to milliseconds
  }

  @action
  playProgression() {
    if (this.progressionChords.length === 0) return;

    this.isPlaying = true;
    this.currentChordIndex = 0;
    this.playCurrentChord();
    this.scheduleNextChord();
  }

  @action
  stopProgression() {
    this.isPlaying = false;
    this.stopAllNotes();

    if (this.playbackTimer) {
      clearTimeout(this.playbackTimer);
      this.playbackTimer = null;
    }

    this.currentChordIndex = 0;
  }

  @action
  playCurrentChord() {
    const chord = this.currentChord;
    if (chord && chord.notesList) {
      this.playChord(chord.notesList, this.chordDuration / 1000);
    }
  }

  scheduleNextChord() {
    if (!this.isPlaying) return;

    this.playbackTimer = window.setTimeout(() => {
      this.currentChordIndex =
        (this.currentChordIndex + 1) % this.progressionChords.length;

      if (this.currentChordIndex === 0) {
        // Completed one cycle, stop or loop
        this.stopProgression();
      } else {
        this.playCurrentChord();
        this.scheduleNextChord();
      }
    }, this.chordDuration);
  }

  @action
  selectProgression(progressionCard: any) {
    if (this.args.model) {
      this.args.model.currentProgression = progressionCard;
      this.stopProgression(); // Stop any current playback
    }
  }

  @action
  playIndividualChord(chord: any) {
    // ¹³¹ Action specifically for individual chord clicks
    if (!chord || !chord.notesList || chord.notesList.length === 0) {
      console.warn('Chord has no notes to play:', chord);
      return;
    }

    console.log(
      'Playing individual chord:',
      chord.chordName,
      'with notes:',
      chord.notesList,
    );
    this.stopProgression(); // Stop any current progression playback
    this.playChord(chord.notesList, 2.0); // Play for 2 seconds
  }

  // ¹²¹ Get available progressions
  get availableProgressions() {
    try {
      return this.args.model?.availableProgressions || [];
    } catch (e) {
      console.error('Error accessing available progressions:', e);
      return [];
    }
  }

  <template>
    <div class='progression-player'>
      <div class='player-header'>
        <div class='header-content'>
          <h2>Chord Progression Explorer</h2>
          <p>Learn music theory by exploring popular chord progressions with
            real-time audio playback and interactive learning tools</p>
        </div>

        <div class='musical-decoration'>
          <svg viewBox='0 0 100 60' class='staff-lines'>
            <line
              x1='10'
              y1='15'
              x2='90'
              y2='15'
              stroke='#e2e8f0'
              stroke-width='1'
            />
            <line
              x1='10'
              y1='25'
              x2='90'
              y2='25'
              stroke='#e2e8f0'
              stroke-width='1'
            />
            <line
              x1='10'
              y1='35'
              x2='90'
              y2='35'
              stroke='#e2e8f0'
              stroke-width='1'
            />
            <line
              x1='10'
              y1='45'
              x2='90'
              y2='45'
              stroke='#e2e8f0'
              stroke-width='1'
            />
            <text
              x='20'
              y='40'
              font-family='serif'
              font-size='20'
              fill='#3b82f6'
            >♪</text>
            <text
              x='70'
              y='30'
              font-family='serif'
              font-size='16'
              fill='#6366f1'
            >♫</text>
          </svg>
        </div>
      </div>

      {{#if (gt this.availableProgressions.length 0)}}
        <div class='progression-library'>
          <h3 class='library-title'>
            <svg
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
              class='library-icon'
            >
              <rect x='2' y='3' width='20' height='14' rx='2' ry='2' />
              <line x1='8' y1='21' x2='16' y2='21' />
              <line x1='12' y1='17' x2='12' y2='21' />
            </svg>
            Choose a Chord Progression
          </h3>
          <div class='progressions-grid'>
            {{#each this.availableProgressions as |progression|}}
              <div
                class='progression-item
                  {{if
                    (eq progression.id @model.currentProgression.id)
                    "selected"
                    ""
                  }}'
              >
                <button
                  class='progression-selector'
                  {{on 'click' (fn this.selectProgression progression)}}
                >
                  <div class='progression-card-preview'>
                    <div class='progression-preview-header'>
                      <p
                        class='progression-preview-name'
                      >{{progression.progressionName}}</p>
                      {{#if (eq progression.id @model.currentProgression.id)}}
                        <span class='current-badge'>CURRENT</span>
                      {{/if}}
                    </div>

                    <div class='progression-preview-info'>
                      <span class='progression-key'>{{progression.key}}</span>
                      <span
                        class='progression-genre'
                      >{{progression.genre}}</span>
                      <span
                        class='progression-difficulty difficulty-{{progression.difficulty}}'
                      >{{progression.difficulty}}</span>
                    </div>

                    {{#if progression.chordProgression.chords}}
                      <div class='chord-preview'>
                        {{#each progression.chordProgression.chords as |chord|}}
                          <span class='chord-chip'>{{chord.chordName}}</span>
                        {{/each}}
                      </div>
                    {{/if}}
                  </div>
                </button>
              </div>
            {{/each}}
          </div>
        </div>
      {{/if}}

      {{#if this.currentProgression}}
        <div class='now-playing-section'>
          <div class='now-playing-header'>
            <h3 class='now-playing-title'>
              <svg
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
                class='now-playing-icon'
              >
                <circle cx='12' cy='12' r='10' />
                <polygon points='10,8 16,12 10,16 10,8' />
              </svg>
              Now Playing
            </h3>
            <div class='current-progression-indicator'>
              <div class='indicator-dot'></div>
              {{this.currentProgression.progressionName}}
            </div>
          </div>

          <div class='current-progression-card'>
            <div class='progression-details'>
              <@fields.currentProgression @format='embedded' />
            </div>

            {{#if (gt this.progressionChords.length 0)}}
              <div class='chord-player'>
                <div class='playback-controls'>
                  {{#if this.isPlaying}}
                    <Button
                      class='control-button stop-button'
                      {{on 'click' this.stopProgression}}
                    >
                      <svg viewBox='0 0 24 24' fill='currentColor'>
                        <rect x='6' y='6' width='12' height='12' />
                      </svg>
                      Stop Progression
                    </Button>
                  {{else}}
                    <Button
                      class='control-button play-button'
                      {{on 'click' this.playProgression}}
                    >
                      <svg viewBox='0 0 24 24' fill='currentColor'>
                        <path d='M8 5v14l11-7z' />
                      </svg>
                      Play Progression
                    </Button>
                  {{/if}}
                </div>

                <div class='chord-sequence'>
                  <div class='sequence-header'>
                    <h4>🎹 Interactive Chord Sequence</h4>
                    <p>Click any chord button below to hear that chord, or use
                      "Play Progression" to hear them all in sequence</p>
                  </div>

                  <div class='chords-display'>
                    {{#each this.progressionChords as |chord index|}}
                      <div
                        class='chord-position
                          {{if
                            (eq index this.currentChordIndex)
                            "currently-playing"
                            ""
                          }}'
                      >
                        <div class='chord-number'>{{add index 1}}</div>
                        <button
                          class='chord-button'
                          {{on 'click' (fn this.playIndividualChord chord)}}
                        >
                          <div class='chord-symbol'>{{chord.chordName}}</div>
                          <div class='chord-quality'>{{chord.quality}}</div>
                        </button>
                        {{#if (gt chord.notesList.length 0)}}
                          <div class='chord-notes'>
                            {{#each chord.notesList as |note|}}
                              <span class='note-pill'>{{note}}</span>
                            {{/each}}
                          </div>
                        {{else}}
                          <div class='chord-notes'>
                            <span class='note-pill no-notes'>No notes</span>
                          </div>
                        {{/if}}
                      </div>
                    {{/each}}
                  </div>
                </div>
              </div>
            {{/if}}
          </div>
        </div>
      {{else}}
        <div class='empty-state'>
          <svg
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            stroke-width='2'
          >
            <polyline points='22,12 18,12 15,21 9,3 6,12 2,12' />
          </svg>
          <h3>No Progression Selected</h3>
          <p>Select a chord progression from the library above to start learning
            with interactive audio playback</p>
        </div>
      {{/if}}

      <div class='theory-section'>
        <h3>🎼 Understanding Chord Progressions</h3>
        <div class='theory-grid'>
          <div class='theory-card'>
            <h4>🔢 Roman Numeral Analysis</h4>
            <p>Chord progressions use Roman numerals (I, ii, iii, IV, V, vi,
              vii°) to show relationships between chords in any key. Uppercase =
              major, lowercase = minor.</p>
          </div>
          <div class='theory-card'>
            <h4>🎵 Popular Patterns</h4>
            <p>The most common progressions like I-V-vi-IV ("Let It Be"), ii-V-I
              (jazz standard), and vi-IV-I-V ("Don't Stop Believin'") appear in
              thousands of songs.</p>
          </div>
          <div class='theory-card'>
            <h4>🔄 Circle of Fifths</h4>
            <p>This musical tool shows key relationships and helps you transpose
              progressions to different keys while maintaining the same harmonic
              feel and emotion.</p>
          </div>
        </div>
      </div>
    </div>

    <style scoped>
      .progression-player {
        background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
        border-radius: 16px;
        padding: 2rem;
        font-family:
          'Inter',
          -apple-system,
          sans-serif;
        max-width: 1200px;
        margin: 0 auto;
      }

      /* Header */
      .player-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 2rem;
        padding-bottom: 1.5rem;
        border-bottom: 1px solid #e2e8f0;
      }

      .header-content h2 {
        font-size: 2rem;
        font-weight: 700;
        color: #1e293b;
        margin: 0 0 0.5rem 0;
        background: linear-gradient(135deg, #3b82f6, #6366f1);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
      }

      .header-content p {
        font-size: 1rem;
        color: #64748b;
        margin: 0;
      }

      .musical-decoration {
        flex-shrink: 0;
        margin-left: 2rem;
      }

      .staff-lines {
        width: 100px;
        height: 60px;
      }

      /* Enhanced Progression Library */
      .progression-library {
        margin-bottom: 2rem;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 16px;
        padding: 2rem;
      }

      .library-title {
        font-size: 1.5rem;
        font-weight: 700;
        color: #1e293b;
        margin: 0 0 0.5rem 0;
        text-align: center;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.75rem;
      }

      .library-icon {
        width: 24px;
        height: 24px;
        color: #3b82f6;
      }

      .progression-library::after {
        content: 'Click any progression card below to load it and start exploring';
        display: block;
        text-align: center;
        font-size: 0.875rem;
        color: #64748b;
        margin-bottom: 1.5rem;
        font-style: italic;
      }

      .progressions-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
        gap: 1rem;
      }

      .progression-item {
        transition: all 0.2s ease;
      }

      .progression-item.selected {
        transform: scale(1.02);
      }

      .progression-selector {
        width: 100%;
        background: none;
        border: none;
        padding: 0;
        cursor: pointer;
        border-radius: 12px;
        overflow: hidden;
        transition: all 0.2s ease;
      }

      .progression-selector:hover {
        transform: translateY(-2px);
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15);
      }

      /* Enhanced Progression Cards with Clear Selection States */
      .progression-card-preview {
        background: white;
        border: 2px solid #e2e8f0;
        border-radius: 12px;
        padding: 1.25rem;
        text-align: left;
        transition: all 0.3s ease;
        position: relative;
        overflow: hidden;
      }

      /* Normal state */
      .progression-card-preview:hover {
        border-color: #60a5fa;
        background: #f8fafc;
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
      }

      /* Selected state - much more prominent */
      .progression-item.selected .progression-card-preview {
        border-color: #3b82f6;
        background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%);
        box-shadow: 0 6px 20px rgba(59, 130, 246, 0.25);
        transform: scale(1.02);
      }

      .progression-item.selected .progression-card-preview::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 4px;
        background: linear-gradient(90deg, #3b82f6, #6366f1);
      }

      .progression-item.selected .progression-card-preview:hover {
        border-color: #2563eb;
        background: linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%);
        box-shadow: 0 8px 24px rgba(59, 130, 246, 0.3);
      }

      .progression-preview-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: 0.75rem;
        gap: 0.75rem;
      }

      .progression-preview-name {
        font-size: 1.125rem;
        font-weight: 700;
        color: #1e293b;
        margin: 0;
        flex: 1;
        line-height: 1.2;
      }

      .current-badge {
        background: #3b82f6;
        color: white;
        padding: 0.375rem 0.75rem;
        border-radius: 8px;
        font-size: 0.75rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        white-space: nowrap;
        animation: current-pulse 2s ease-in-out infinite;
        box-shadow: 0 2px 8px rgba(59, 130, 246, 0.3);
      } /* ¹²⁶ More prominent current indicator */

      @keyframes current-pulse {
        0%,
        100% {
          opacity: 1;
          transform: scale(1);
        }
        50% {
          opacity: 0.85;
          transform: scale(1.05);
        }
      }

      .progression-preview-info {
        display: flex;
        gap: 0.5rem;
        margin-bottom: 0.75rem;
        flex-wrap: wrap;
      }

      .progression-key {
        background: #f3f4f6;
        color: #374151;
        padding: 0.25rem 0.5rem;
        border-radius: 6px;
        font-size: 0.75rem;
        font-weight: 600;
        font-family: 'Georgia', serif;
      }

      .progression-genre {
        background: #e0e7ff;
        color: #3730a3;
        padding: 0.25rem 0.5rem;
        border-radius: 6px;
        font-size: 0.75rem;
        font-weight: 600;
      }

      .progression-difficulty {
        padding: 0.25rem 0.5rem;
        border-radius: 6px;
        font-size: 0.75rem;
        font-weight: 600;
        text-transform: capitalize;
      }

      .progression-difficulty {
        background: #dcfce7;
        color: #166534;
      }

      /* Difficulty color overrides */
      .progression-item:has([data-difficulty='intermediate'])
        .progression-difficulty {
        background: #fef3c7;
        color: #92400e;
      }

      .progression-item:has([data-difficulty='advanced'])
        .progression-difficulty {
        background: #fee2e2;
        color: #991b1b;
      }

      .chord-preview {
        display: flex;
        gap: 0.25rem;
        flex-wrap: wrap;
      }

      .chord-chip {
        background: #f1f5f9;
        color: #334155;
        padding: 0.125rem 0.375rem;
        border-radius: 4px;
        font-size: 0.625rem;
        font-weight: 600;
        font-family: 'Georgia', serif;
        border: 1px solid #e2e8f0;
      }

      .progression-item.selected .chord-chip {
        background: #3b82f6;
        color: white;
        border-color: #2563eb;
      }

      /* Enhanced Now Playing Section */
      .now-playing-section {
        background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%);
        border: 3px solid #0284c7;
        border-radius: 20px;
        padding: 2.5rem;
        margin-bottom: 2.5rem;
        position: relative;
        box-shadow: 0 8px 32px rgba(2, 132, 199, 0.15);
      } /* ¹²⁷ Much more prominent "Now Playing" section */

      .now-playing-section::before {
        content: '';
        position: absolute;
        top: -3px;
        left: -3px;
        right: -3px;
        bottom: -3px;
        background: linear-gradient(45deg, #0284c7, #0ea5e9, #38bdf8, #0284c7);
        border-radius: 20px;
        z-index: -1;
        animation: border-gradient 3s linear infinite;
      }

      @keyframes border-gradient {
        0% {
          background-position: 0% 50%;
        }
        50% {
          background-position: 100% 50%;
        }
        100% {
          background-position: 0% 50%;
        }
      }

      .now-playing-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 2rem;
        padding-bottom: 1.5rem;
        border-bottom: 2px solid #0284c7;
      }

      .now-playing-title {
        font-size: 1.75rem;
        font-weight: 800;
        color: #0c4a6e;
        margin: 0;
        display: flex;
        align-items: center;
        gap: 0.75rem;
      }

      .now-playing-icon {
        width: 28px;
        height: 28px;
        color: #0284c7;
      }

      .current-progression-indicator {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        background: linear-gradient(135deg, #0284c7, #0ea5e9);
        color: white;
        padding: 0.75rem 1.5rem;
        border-radius: 12px;
        font-size: 1rem;
        font-weight: 700;
        box-shadow: 0 4px 12px rgba(2, 132, 199, 0.3);
      }

      .indicator-dot {
        width: 10px;
        height: 10px;
        background: #22d3ee;
        border-radius: 50%;
        animation: indicator-pulse 2s ease-in-out infinite;
      }

      @keyframes indicator-pulse {
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

      .current-progression-card {
        background: white;
        border-radius: 16px;
        padding: 2rem;
        box-shadow: 0 6px 20px rgba(2, 132, 199, 0.1);
        border: 2px solid #bae6fd;
      }

      /* Enhanced Chord Interaction Display */
      .chord-sequence .sequence-header {
        text-align: center;
        margin-bottom: 2rem;
        background: rgba(6, 182, 212, 0.1);
        padding: 1.5rem;
        border-radius: 12px;
        border: 1px solid #67e8f9;
      } /* ¹²⁸ More prominent instruction section */

      .sequence-header h4 {
        font-size: 1.375rem;
        font-weight: 700;
        color: #0c4a6e;
        margin: 0 0 0.75rem 0;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
      }

      .sequence-header h4::before {
        content: '🎹';
        font-size: 1.5rem;
      }

      .sequence-header p {
        font-size: 1rem;
        color: #0369a1;
        margin: 0;
        font-weight: 500;
      }

      .chords-display {
        display: flex;
        gap: 1.5rem;
        justify-content: center;
        flex-wrap: wrap;
        margin-top: 2rem;
      }

      .chord-position {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.75rem;
        padding: 1.5rem;
        border-radius: 16px;
        transition: all 0.3s ease;
        position: relative;
        background: rgba(255, 255, 255, 0.7);
        border: 2px solid #e0f2fe;
      }

      .chord-position:hover {
        background: rgba(255, 255, 255, 0.9);
        transform: translateY(-2px);
        box-shadow: 0 6px 20px rgba(59, 130, 246, 0.15);
      }

      .chord-position.currently-playing {
        background: linear-gradient(135deg, #fef3c7, #fde68a);
        border: 3px solid #f59e0b;
        transform: scale(1.1);
        box-shadow: 0 12px 32px rgba(245, 158, 11, 0.4);
        z-index: 10;
      }

      .chord-position.currently-playing::before {
        content: 'CURRENTLY PLAYING';
        position: absolute;
        top: -0.75rem;
        left: 50%;
        transform: translateX(-50%);
        background: #f59e0b;
        color: white;
        padding: 0.375rem 0.75rem;
        border-radius: 6px;
        font-size: 0.75rem;
        font-weight: 800;
        letter-spacing: 0.05em;
        animation: playing-badge 1.5s ease-in-out infinite;
        white-space: nowrap;
        box-shadow: 0 4px 12px rgba(245, 158, 11, 0.4);
      }

      @keyframes playing-badge {
        0%,
        100% {
          opacity: 1;
          transform: translateX(-50%) scale(1);
        }
        50% {
          opacity: 0.9;
          transform: translateX(-50%) scale(1.05);
        }
      }

      .chord-number {
        background: #e0f2fe;
        color: #0369a1;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 0.875rem;
        font-weight: 800;
        margin-bottom: 0.5rem;
        border: 2px solid #7dd3fc;
      }

      .chord-position.currently-playing .chord-number {
        background: #f59e0b;
        color: white;
        border-color: #f97316;
        animation: number-glow 1s ease-in-out infinite;
      }

      @keyframes number-glow {
        0%,
        100% {
          box-shadow: 0 0 0 rgba(245, 158, 11, 0.5);
        }
        50% {
          box-shadow: 0 0 12px rgba(245, 158, 11, 0.8);
        }
      }

      /* Chord Player */
      .chord-player {
        margin-top: 1.5rem;
      }

      .playback-controls {
        display: flex;
        justify-content: center;
        margin-bottom: 1.5rem;
      }

      .control-button {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.75rem 1.5rem;
        border-radius: 12px;
        border: none;
        font-size: 1rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .play-button {
        background: #10b981;
        color: white;
      }

      .play-button:hover {
        background: #059669;
        transform: translateY(-1px);
      }

      .stop-button {
        background: #ef4444;
        color: white;
      }

      .stop-button:hover {
        background: #dc2626;
      }

      .control-button svg {
        width: 20px;
        height: 20px;
      }

      /* Chord Sequence */
      .chord-sequence {
        display: flex;
        gap: 1rem;
        justify-content: center;
        flex-wrap: wrap;
      }

      .chord-position {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.5rem;
        padding: 1rem;
        border-radius: 12px;
        transition: all 0.3s ease;
      }

      .chord-position.current {
        background: linear-gradient(135deg, #dbeafe, #e0e7ff);
        border: 2px solid #3b82f6;
        transform: scale(1.05);
      }

      .chord-button {
        background: #f8fafc;
        border: 2px solid #e2e8f0;
        border-radius: 12px;
        padding: 1rem;
        cursor: pointer;
        transition: all 0.2s ease;
        min-width: 80px;
        text-align: center;
      }

      .chord-button:hover {
        border-color: #3b82f6;
        background: #eff6ff;
      }

      .chord-position.current .chord-button {
        border-color: #3b82f6;
        background: white;
      }

      .chord-symbol {
        font-size: 1.5rem;
        font-weight: 700;
        color: #1e293b;
        font-family: 'Georgia', serif;
        margin-bottom: 0.25rem;
      }

      .chord-quality {
        font-size: 0.75rem;
        color: #64748b;
        text-transform: capitalize;
      }

      .chord-notes {
        display: flex;
        gap: 0.25rem;
        flex-wrap: wrap;
        justify-content: center;
      }

      .note-pill {
        background: #3b82f6;
        color: white;
        padding: 0.125rem 0.375rem;
        border-radius: 8px;
        font-size: 0.625rem;
        font-weight: 600;
      }

      .note-pill.no-notes {
        background: #ef4444;
        color: white;
      } /* ¹³⁷ Debug styling for missing notes */

      /* Empty State */
      .empty-state {
        text-align: center;
        padding: 3rem;
        color: #64748b;
      }

      .empty-state svg {
        width: 64px;
        height: 64px;
        margin: 0 auto 1rem auto;
        color: #cbd5e1;
      }

      .empty-state h3 {
        font-size: 1.25rem;
        font-weight: 600;
        margin: 0 0 0.5rem 0;
      }

      .empty-state p {
        font-size: 1rem;
        margin: 0;
        line-height: 1.5;
      }

      /* Theory Section */
      .theory-section {
        background: rgba(59, 130, 246, 0.05);
        border: 1px solid #dbeafe;
        border-radius: 12px;
        padding: 1.5rem;
      }

      .theory-section h3 {
        font-size: 1.25rem;
        font-weight: 600;
        color: #1e40af;
        margin: 0 0 1rem 0;
      }

      .theory-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 1rem;
      }

      .theory-card {
        background: white;
        border-radius: 8px;
        padding: 1rem;
        border: 1px solid #e0e7ff;
      }

      .theory-card h4 {
        font-size: 1rem;
        font-weight: 600;
        color: #1e40af;
        margin: 0 0 0.5rem 0;
      }

      .theory-card p {
        font-size: 0.875rem;
        color: #475569;
        margin: 0;
        line-height: 1.5;
      }

      /* Responsive Design */
      @media (max-width: 768px) {
        .progression-player {
          padding: 1rem;
        }

        .player-header {
          flex-direction: column;
          text-align: center;
          gap: 1rem;
        }

        .musical-decoration {
          margin-left: 0;
        }

        .chord-sequence {
          gap: 0.5rem;
        }

        .chord-position {
          padding: 0.75rem;
        }

        .chord-button {
          min-width: 60px;
          padding: 0.75rem;
        }

        .chord-symbol {
          font-size: 1.25rem;
        }
      }
    </style>
  </template>
}

export class ChordProgressionCard extends CardDef {
  static displayName = 'Chord Progression';
  static icon = MusicIcon;

  @field progressionName = contains(StringField);
  @field description = contains(StringField);
  @field key = contains(StringField);
  @field scale = contains(StringField); // e.g., "major", "minor", "dorian"
  @field timeSignature = contains(StringField);
  @field tempo = contains(NumberField);
  @field genre = contains(StringField);
  @field difficulty = contains(StringField); // "beginner", "intermediate", "advanced"
  @field chordProgression = contains(ChordProgressionField);
  @field popularSongs = contains(StringField); // Examples that use this progression

  @field title = contains(StringField, {
    computeVia: function (this: ChordProgressionCard) {
      try {
        return this.progressionName ?? 'Chord Progression';
      } catch (e) {
        console.error('ChordProgressionCard: Error computing title', e);
        return 'Chord Progression';
      }
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='chord-progression-card'>
        <div class='progression-header'>
          <h3 class='progression-title'>{{if
              @model.progressionName
              @model.progressionName
              'Untitled Progression'
            }}</h3>
          <div class='progression-badges'>
            {{#if @model.difficulty}}
              <span
                class='difficulty-badge {{@model.difficulty}}'
              >{{@model.difficulty}}</span>
            {{/if}}
            {{#if @model.genre}}
              <span class='genre-badge'>{{@model.genre}}</span>
            {{/if}}
          </div>
        </div>

        <div class='progression-info'>
          <div class='music-details'>
            {{#if @model.key}}
              <div class='detail-item'>
                <span class='detail-label'>Key:</span>
                <span class='detail-value'>{{@model.key}}</span>
              </div>
            {{/if}}
            {{#if @model.scale}}
              <div class='detail-item'>
                <span class='detail-label'>Scale:</span>
                <span class='detail-value'>{{@model.scale}}</span>
              </div>
            {{/if}}
            {{#if @model.timeSignature}}
              <div class='detail-item'>
                <span class='detail-label'>Time:</span>
                <span class='detail-value'>{{@model.timeSignature}}</span>
              </div>
            {{/if}}
            {{#if @model.tempo}}
              <div class='detail-item'>
                <span class='detail-label'>Tempo:</span>
                <span class='detail-value'>{{@model.tempo}} BPM</span>
              </div>
            {{/if}}
          </div>
        </div>

        {{#if @model.description}}
          <p class='progression-description'>{{@model.description}}</p>
        {{/if}}

        {{#if @fields.chordProgression}}
          <div class='progression-preview'>
            <@fields.chordProgression @format='embedded' />
          </div>
        {{/if}}

        {{#if @model.popularSongs}}
          <div class='examples-section'>
            <h5>Popular songs using this progression:</h5>
            <p class='song-examples'>{{@model.popularSongs}}</p>
          </div>
        {{/if}}
      </div>

      <style scoped>
        .chord-progression-card {
          background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
          border: 1px solid #e2e8f0;
          border-radius: 16px;
          padding: 1.5rem;
          transition: all 0.3s ease;
        }

        .chord-progression-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.1);
          border-color: #3b82f6;
        }

        .progression-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 1rem;
        }

        .progression-title {
          font-size: 1.25rem;
          font-weight: 700;
          color: #1e293b;
          margin: 0;
          flex: 1;
          margin-right: 1rem;
        }

        .progression-badges {
          display: flex;
          gap: 0.5rem;
          flex-wrap: wrap;
        }

        .difficulty-badge {
          padding: 0.25rem 0.75rem;
          border-radius: 12px;
          font-size: 0.75rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.025em;
        }

        .difficulty-badge.beginner {
          background: #dcfce7;
          color: #166534;
        }

        .difficulty-badge.intermediate {
          background: #fef3c7;
          color: #92400e;
        }

        .difficulty-badge.advanced {
          background: #fee2e2;
          color: #991b1b;
        }

        .genre-badge {
          background: #e0e7ff;
          color: #3730a3;
          padding: 0.25rem 0.75rem;
          border-radius: 12px;
          font-size: 0.75rem;
          font-weight: 600;
        }

        .progression-info {
          margin-bottom: 1rem;
        }

        .music-details {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
          gap: 0.75rem;
        }

        .detail-item {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .detail-label {
          font-size: 0.75rem;
          color: #64748b;
          font-weight: 600;
        }

        .detail-value {
          font-size: 0.875rem;
          color: #1e293b;
          font-weight: 600;
          font-family: 'Georgia', serif;
        }

        .progression-description {
          font-size: 0.875rem;
          color: #475569;
          margin: 0 0 1rem 0;
          line-height: 1.5;
        }

        .progression-preview {
          margin-bottom: 1rem;
        }

        .examples-section {
          background: rgba(59, 130, 246, 0.05);
          border: 1px solid #dbeafe;
          border-radius: 8px;
          padding: 1rem;
        }

        .examples-section h5 {
          font-size: 0.875rem;
          font-weight: 600;
          color: #1e40af;
          margin: 0 0 0.5rem 0;
        }

        .song-examples {
          font-size: 0.875rem;
          color: #1e40af;
          margin: 0;
          line-height: 1.4;
        }
      </style>
    </template>
  };
}

export class ChordProgressionPlayerCard extends CardDef {
  static displayName = 'Chord Progression Player';
  static icon = MusicIcon;

  @field currentProgression = linksTo(() => ChordProgressionCard);
  @field availableProgressions = linksToMany(() => ChordProgressionCard);
  @field playerName = contains(StringField);

  @field title = contains(StringField, {
    computeVia: function (this: ChordProgressionPlayerCard) {
      try {
        return this.playerName ?? 'Chord Progression Player';
      } catch (e) {
        console.error('ChordProgressionPlayerCard: Error computing title', e);
        return 'Chord Progression Player';
      }
    },
  });

  static isolated = ChordProgressionPlayerIsolated;

  static fitted = class Fitted extends Component<typeof this> {
    <template>
      <div class='fitted-container'>
        <div class='badge-format'>
          <div class='badge-content'>
            <div class='badge-icon'>
              <div class='chord-symbol-mini'>♪</div>
            </div>
            <div class='badge-info'>
              <div class='badge-title'>{{if
                  @model.playerName
                  @model.playerName
                  'Harmony Explorer'
                }}</div>
              <div class='badge-stats'>{{if
                  @model.currentProgression.key
                  @model.currentProgression.key
                  'C major'
                }}</div>
            </div>
          </div>
        </div>

        <div class='strip-format'>
          <div class='strip-content'>
            <div class='strip-visual'>
              <div class='chord-sequence-mini'>
                <div class='chord-mini'>I</div>
                <div class='chord-mini'>V</div>
                <div class='chord-mini'>vi</div>
                <div class='chord-mini'>IV</div>
              </div>
            </div>
            <div class='strip-info'>
              <div class='strip-title'>{{if
                  @model.playerName
                  @model.playerName
                  'Harmony Explorer'
                }}</div>
              <div class='strip-description'>{{if
                  @model.currentProgression.progressionName
                  @model.currentProgression.progressionName
                  'Popular Progressions'
                }}
                •
                {{@model.availableProgressions.length}}
                available</div>
            </div>
            <div class='strip-badge'>
              <div class='play-indicator'></div>
              LEARN
            </div>
          </div>
        </div>

        <div class='tile-format'>
          <div class='tile-header'>
            <div class='tile-visual'>
              <div class='staff-notation'>
                <div class='staff-lines'>
                  <div class='staff-line'></div>
                  <div class='staff-line'></div>
                  <div class='staff-line'></div>
                  <div class='staff-line'></div>
                </div>
                <div class='chord-symbols'>
                  {{#if @model.currentProgression.chordProgression.chords}}
                    {{#each
                      @model.currentProgression.chordProgression.chords
                      as |chord index|
                    }}
                      {{#if (lt index 4)}}
                        <div class='chord-note'>{{chord.chordName}}</div>
                      {{/if}}
                    {{/each}}
                  {{else}}
                    <div class='chord-note'>Am</div>
                    <div class='chord-note'>F</div>
                    <div class='chord-note'>C</div>
                    <div class='chord-note'>G</div>
                  {{/if}}
                </div>
              </div>
            </div>
          </div>
          <div class='tile-content'>
            <h3 class='tile-title'>{{if
                @model.playerName
                @model.playerName
                'Harmony Explorer'
              }}</h3>
            <div class='tile-specs'>
              <div class='spec-row'>
                <span class='spec-label'>Current:</span>
                <span class='spec-value'>{{if
                    @model.currentProgression.progressionName
                    @model.currentProgression.progressionName
                    'Andalusian Cadence'
                  }}</span>
              </div>
              <div class='spec-row'>
                <span class='spec-label'>Key:</span>
                <span class='spec-value'>{{if
                    @model.currentProgression.key
                    @model.currentProgression.key
                    'A minor'
                  }}</span>
              </div>
              <div class='spec-row'>
                <span class='spec-label'>Library:</span>
                <span class='spec-value'>{{@model.availableProgressions.length}}
                  progressions</span>
              </div>
            </div>
            <div class='tile-features'>
              <div class='feature-tag'>Audio</div>
              <div class='feature-tag'>Theory</div>
              <div class='feature-tag'>Learn</div>
            </div>
          </div>
        </div>

        <div class='card-format'>
          <div class='card-header'>
            <div class='card-info'>
              <h3 class='card-title'>{{if
                  @model.playerName
                  @model.playerName
                  'Harmony Explorer'
                }}</h3>
              <p class='card-description'>Interactive chord progression player
                with audio synthesis and music theory education</p>
            </div>
            <div class='card-visual'>
              <div class='musical-notation'>
                <div class='treble-clef'>𝄞</div>
                <div class='notation-staff'>
                  <div class='staff-line'></div>
                  <div class='staff-line'></div>
                  <div class='staff-line'></div>
                  <div class='staff-line'></div>
                  <div class='staff-line'></div>
                </div>
                <div class='chord-progression-display'>
                  {{#if @model.currentProgression.chordProgression.chords}}
                    {{#each
                      @model.currentProgression.chordProgression.chords
                      as |chord index|
                    }}
                      {{#if (lt index 4)}}
                        <div class='chord-symbol'>{{chord.chordName}}</div>
                      {{/if}}
                    {{/each}}
                  {{else}}
                    <div class='chord-symbol'>Am</div>
                    <div class='chord-symbol'>G</div>
                    <div class='chord-symbol'>F</div>
                    <div class='chord-symbol'>E</div>
                  {{/if}}
                </div>
              </div>
            </div>
          </div>
          <div class='card-stats'>
            <div class='stats-grid'>
              <div class='stat-group'>
                <div class='stat-number'>{{if
                    @model.availableProgressions.length
                    @model.availableProgressions.length
                    12
                  }}</div>
                <div class='stat-label'>Progressions</div>
              </div>
              <div class='stat-group'>
                <div class='stat-number'>{{if
                    @model.currentProgression.chordProgression.chords.length
                    @model.currentProgression.chordProgression.chords.length
                    4
                  }}</div>
                <div class='stat-label'>Chords</div>
              </div>
              <div class='stat-group'>
                <div class='stat-number'>{{if
                    @model.currentProgression.tempo
                    @model.currentProgression.tempo
                    80
                  }}</div>
                <div class='stat-label'>BPM</div>
              </div>
            </div>
          </div>
          <div class='card-features'>
            <div class='features-label'>Learning Features:</div>
            <div class='feature-list'>
              <div class='feature-pill'>Audio Playback</div>
              <div class='feature-pill'>Roman Numerals</div>
              <div class='feature-pill'>Theory Guide</div>
              <div class='feature-pill'>Song Examples</div>
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
          background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
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
          display: flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, #3b82f6 0%, #6366f1 100%);
          border-radius: 6px;
          flex-shrink: 0;
        }

        .chord-symbol-mini {
          color: white;
          font-size: 14px;
          font-weight: 700;
          font-family: 'Georgia', serif;
        }

        .badge-info {
          flex: 1;
          min-width: 0;
        }

        .badge-title {
          font-size: 0.75rem;
          font-weight: 700;
          color: #3b82f6;
          line-height: 1.2;
          margin-bottom: 0.125rem;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .badge-stats {
          font-size: 0.625rem;
          color: rgba(59, 130, 246, 0.7);
          font-family: 'Georgia', serif;
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

        .chord-sequence-mini {
          display: flex;
          gap: 2px;
          align-items: center;
        }

        .chord-mini {
          width: 18px;
          height: 18px;
          background: #3b82f6;
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 4px;
          font-size: 0.625rem;
          font-weight: 700;
          font-family: 'Georgia', serif;
        }

        .strip-info {
          flex: 1;
          min-width: 0;
        }

        .strip-title {
          font-size: 0.875rem;
          font-weight: 700;
          color: #3b82f6;
          line-height: 1.2;
          margin-bottom: 0.25rem;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .strip-description {
          font-size: 0.75rem;
          color: rgba(59, 130, 246, 0.7);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .strip-badge {
          display: flex;
          align-items: center;
          gap: 0.25rem;
          padding: 0.25rem 0.5rem;
          background: rgba(16, 185, 129, 0.2);
          border: 1px solid #10b981;
          border-radius: 6px;
          font-size: 0.625rem;
          font-weight: 700;
          color: #10b981;
          font-family: 'JetBrains Mono', monospace;
          flex-shrink: 0;
        }

        .play-indicator {
          width: 6px;
          height: 6px;
          background: #10b981;
          border-radius: 50%;
          animation: learn-pulse 2s ease-in-out infinite;
        }

        @keyframes learn-pulse {
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
          background: linear-gradient(135deg, #3b82f6 0%, #6366f1 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 1rem;
          border-radius: 8px;
        }

        .staff-notation {
          position: relative;
          width: 80px;
          height: 40px;
        }

        .staff-lines {
          position: absolute;
          top: 50%;
          left: 0;
          right: 0;
          transform: translateY(-50%);
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .staff-line {
          height: 1px;
          background: rgba(255, 255, 255, 0.6);
          width: 100%;
        }

        .chord-symbols {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 4px;
        }

        .chord-note {
          color: white;
          font-size: 0.625rem;
          font-weight: 700;
          font-family: 'Georgia', serif;
          background: rgba(255, 255, 255, 0.2);
          border-radius: 3px;
          padding: 0.125rem 0.25rem;
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
          color: #3b82f6;
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
          color: rgba(59, 130, 246, 0.7);
          font-weight: 500;
        }

        .spec-value {
          font-size: 0.875rem;
          color: #3b82f6;
          font-weight: 600;
          font-family: 'Georgia', serif;
        }

        .tile-features {
          display: flex;
          flex-wrap: wrap;
          gap: 0.375rem;
          margin-top: auto;
        }

        .feature-tag {
          padding: 0.25rem 0.5rem;
          background: rgba(59, 130, 246, 0.2);
          border: 1px solid #3b82f6;
          color: #3b82f6;
          font-size: 0.625rem;
          font-weight: 600;
          border-radius: 4px;
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
          background: linear-gradient(135deg, #3b82f6 0%, #6366f1 100%);
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

        .musical-notation {
          position: relative;
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0.75rem;
          background: rgba(15, 23, 42, 0.7);
          backdrop-filter: blur(8px);
          border-radius: 8px;
          min-width: 140px;
        }

        .treble-clef {
          color: rgba(255, 255, 255, 0.9);
          font-size: 1.5rem;
          font-weight: 700;
        }

        .notation-staff {
          position: relative;
          width: 60px;
          height: 32px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
        }

        .notation-staff .staff-line {
          height: 1px;
          background: rgba(255, 255, 255, 0.4);
          width: 100%;
        }

        .chord-progression-display {
          position: absolute;
          top: 0;
          left: 32px;
          right: 0;
          bottom: 0;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 4px;
        }

        .chord-symbol {
          color: white;
          font-size: 0.75rem;
          font-weight: 700;
          font-family: 'Georgia', serif;
          background: rgba(255, 255, 255, 0.2);
          border-radius: 4px;
          padding: 0.125rem 0.25rem;
        }

        .card-stats {
          background: rgba(248, 250, 252, 0.8);
          border-radius: 8px;
          padding: 1rem;
          margin-bottom: 1rem;
        }

        .stats-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 1rem;
        }

        .stat-group {
          text-align: center;
        }

        .stat-number {
          font-size: 1.5rem;
          font-weight: 700;
          color: #3b82f6;
          margin-bottom: 0.25rem;
          font-family: 'JetBrains Mono', monospace;
        }

        .stat-label {
          font-size: 0.75rem;
          color: rgba(59, 130, 246, 0.7);
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .card-features {
          margin-top: auto;
        }

        .features-label {
          font-size: 0.75rem;
          color: rgba(59, 130, 246, 0.7);
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
          background: linear-gradient(135deg, #3b82f6 0%, #6366f1 100%);
          color: white;
          font-size: 0.75rem;
          font-weight: 600;
          border-radius: 6px;
          border: 1px solid rgba(255, 255, 255, 0.1);
        }
      </style>
    </template>
  };
}
