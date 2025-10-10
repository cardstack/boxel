import {
  CardDef,
  Component,
  FieldDef,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import BooleanField from 'https://cardstack.com/base/boolean';
import NumberField from 'https://cardstack.com/base/number';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { modifier } from 'ember-modifier';

// Custom modifier to handle both global and element-specific events
const pianoEventModifier = modifier(
  (
    element: Element,
    [enabled, onKeyDown, onKeyUp, onBeforeUnload, onPageHide, onMouseLeave]: [
      boolean,
      (event: KeyboardEvent) => void,
      (event: KeyboardEvent) => void,
      () => void,
      () => void,
      (event: MouseEvent) => void,
    ],
  ) => {
    if (!enabled) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => onKeyDown(event);
    const handleKeyUp = (event: KeyboardEvent) => onKeyUp(event);
    const handleBeforeUnload = () => onBeforeUnload();
    const handlePageHide = () => onPageHide();
    const handleMouseLeave = (event: Event) =>
      onMouseLeave(event as MouseEvent);

    // Global window events
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pagehide', handlePageHide);

    // Element-specific events
    element.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      // Clean up global events
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('pagehide', handlePageHide);

      // Clean up element-specific events
      element.removeEventListener('mouseleave', handleMouseLeave);
    };
  },
);

export class KeyField extends FieldDef {
  static displayName = 'Key';
  @field note = contains(StringField);
  @field octave = contains(NumberField);
  @field isWhite = contains(BooleanField);
  @field keyboardKey = contains(StringField);
}

class IsolatedPianoTemplate extends Component<typeof Piano> {
  audioContext: AudioContext | null = null;

  // Use non-tracked variables for playback state to avoid rerenders during playback
  private _isPlaying = false;
  private _isPaused = false;
  private _currentTokenIndex = 0;
  private _cancelPlayback = false;

  @tracked pressedKeys = new Set<string>();
  @tracked pianoFocused = false;
  @tracked showNotationTranslation = false;
  @tracked isRecording = false;
  @tracked playbackButtonState = 'play'; // 'play', 'pause', 'resume'
  @tracked recordedNotes: Array<{
    note: string;
    octave: number;
    timestamp: number;
  }> = [];
  @tracked recordingStartTime = 0;
  @tracked audioReady = false;

  keyboardMapping: Record<string, { note: string; octave: number }> = {
    // Octave 3
    q: { note: 'C', octave: 3 },
    '2': { note: 'C#', octave: 3 },
    w: { note: 'D', octave: 3 },
    '3': { note: 'D#', octave: 3 },
    e: { note: 'E', octave: 3 },
    r: { note: 'F', octave: 3 },
    '5': { note: 'F#', octave: 3 },
    t: { note: 'G', octave: 3 },
    '6': { note: 'G#', octave: 3 },
    y: { note: 'A', octave: 3 },
    '7': { note: 'A#', octave: 3 },
    u: { note: 'B', octave: 3 },

    // Octave 4
    i: { note: 'C', octave: 4 },
    '9': { note: 'C#', octave: 4 },
    o: { note: 'D', octave: 4 },
    '0': { note: 'D#', octave: 4 },
    p: { note: 'E', octave: 4 },
    z: { note: 'F', octave: 4 },
    s: { note: 'F#', octave: 4 },
    x: { note: 'G', octave: 4 },
    d: { note: 'G#', octave: 4 },
    c: { note: 'A', octave: 4 },
    f: { note: 'A#', octave: 4 },
    v: { note: 'B', octave: 4 },

    // Octave 5
    b: { note: 'C', octave: 5 },
    h: { note: 'C#', octave: 5 },
    n: { note: 'D', octave: 5 },
    j: { note: 'D#', octave: 5 },
    m: { note: 'E', octave: 5 },
    ',': { note: 'F', octave: 5 },
    l: { note: 'F#', octave: 5 },
    '.': { note: 'G', octave: 5 },
    ';': { note: 'G#', octave: 5 },
    '/': { note: 'A', octave: 5 },
    "'": { note: 'A#', octave: 5 },
    ']': { note: 'B', octave: 5 },
  };

  // Getters for reactive state that use tracked properties
  get isPlaying() {
    return this._isPlaying;
  }

  get isPaused() {
    return this._isPaused;
  }

  get currentTokenIndex() {
    return this._currentTokenIndex;
  }

  get cancelPlayback() {
    return this._cancelPlayback;
  }

  // Computed property for button state that only updates when needed
  get buttonIcon() {
    switch (this.playbackButtonState) {
      case 'pause':
        return '⏸';
      case 'resume':
        return '▶';
      default:
        return '▶';
    }
  }

  get buttonText() {
    switch (this.playbackButtonState) {
      case 'pause':
        return 'Pause';
      case 'resume':
        return 'Resume';
      default:
        return 'Play';
    }
  }

  // Computed property to determine if keyboard listeners should be enabled
  get keyboardListenersEnabled() {
    return this.pianoFocused || this.isRecording;
  }

  @action
  cleanupAudio() {
    // Stop any ongoing playback
    this._cancelPlayback = true;
    this._isPlaying = false;
    this._isPaused = false;
    this._currentTokenIndex = 0;

    // Clear pressed keys
    this.pressedKeys.clear();

    // Close audio context if it exists
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext
        .close()
        .then(() => {
          console.log('Audio context closed');
          this.audioContext = null;
          this.audioReady = false;
        })
        .catch((error) => {
          console.error('Error closing audio context:', error);
        });
    }
  }

  @action
  handleKeyDown(event: KeyboardEvent) {
    if (event.repeat) return;

    const mapping = this.keyboardMapping[event.key.toLowerCase()];
    if (mapping) {
      this.playNote(mapping.note, mapping.octave);
      this.pressedKeys.add(`${mapping.note}${mapping.octave}`);
      this.setPianoKeyActive(mapping.note, mapping.octave, true);

      if (this.isRecording) {
        const timestamp = Date.now() - this.recordingStartTime;
        this.recordedNotes.push({
          note: mapping.note,
          octave: mapping.octave,
          timestamp: timestamp,
        });
      }
    }
  }

  @action
  handleKeyUp(event: KeyboardEvent) {
    const mapping = this.keyboardMapping[event.key.toLowerCase()];
    if (mapping) {
      this.pressedKeys.delete(`${mapping.note}${mapping.octave}`);
      this.setPianoKeyActive(mapping.note, mapping.octave, false);
    }
  }

  setPianoKeyActive(
    note: string,
    octave: number,
    isActive: boolean,
    type: 'keyboard' | 'notation' = 'keyboard',
  ) {
    const keySelector = `[data-note="${note}"][data-octave="${octave}"]`;
    const pianoKey = document.querySelector(keySelector) as HTMLElement;

    if (pianoKey) {
      if (isActive) {
        if (type === 'notation') {
          pianoKey.classList.add('notation-playing');
        } else {
          pianoKey.classList.add('keyboard-pressed');
        }
      } else {
        pianoKey.classList.remove('keyboard-pressed', 'notation-playing');
      }
    }
  }

  playNote(
    note: string,
    octave: number,
    duration = 0.8,
    isNotationPlayback = false,
  ) {
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
    }

    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume().catch((error) => {
        console.error('Failed to resume audio context:', error);
        return;
      });
    }

    const frequency = this.getFrequency(note, octave);
    const oscillator = this.audioContext.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(
      frequency,
      this.audioContext.currentTime,
    );

    const gainNode = this.audioContext.createGain();
    const now = this.audioContext.currentTime;
    gainNode.gain.setValueAtTime(0.5, now);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + duration);

    oscillator.connect(gainNode);
    gainNode.connect(this.audioContext.destination);
    oscillator.start();
    oscillator.stop(now + duration);

    // Don't modify tracked properties during notation playback
    if (!isNotationPlayback && !this._isPlaying) {
      this.pressedKeys.add(`${note}${octave}`);
      setTimeout(() => {
        this.pressedKeys.delete(`${note}${octave}`);
      }, duration * 1000);
    }
  }

  playSingleNote(note: string, octave: number, duration = 0.8) {
    this.playNote(note, octave, duration, true);
    // Add visual feedback for notation playback
    this.setPianoKeyActive(note, octave, true, 'notation');
    setTimeout(() => {
      this.setPianoKeyActive(note, octave, false, 'notation');
    }, duration * 1000);
  }

  getFrequency(note: string, octave: number): number {
    const noteFrequencies: { [key: string]: number } = {
      C: 261.63,
      'C#': 277.18,
      D: 293.66,
      'D#': 311.13,
      E: 329.63,
      F: 349.23,
      'F#': 369.99,
      G: 392.0,
      'G#': 415.3,
      A: 440.0,
      'A#': 466.16,
      B: 493.88,
    };

    const baseFrequency = noteFrequencies[note];
    if (baseFrequency) {
      return baseFrequency * Math.pow(2, octave - 4);
    }

    console.warn(`Unknown note: ${note}`);
    return 440;
  }

  getKeyboardKey(note: string, octave: number) {
    for (const [key, mapping] of Object.entries(this.keyboardMapping)) {
      if (mapping.note === note && mapping.octave === octave) {
        return key.toUpperCase();
      }
    }
    return '';
  }

  parseNote(token: string): { note: string; octave: number } | null {
    const match = token.match(/^([A-G]#?)(\d+)?$/);
    if (match) {
      const note = match[1];
      const octave = match[2] ? parseInt(match[2]) : 4;
      return { note, octave };
    }
    return null;
  }

  @action
  async playNotation() {
    // If already playing, pause it
    if (this._isPlaying && !this._isPaused) {
      this.pausePlayback();
      return;
    }

    // If paused, resume from current position
    if (this._isPaused) {
      this.resumePlayback();
      return;
    }

    // Start new playback
    this.startPlayback();
  }

  @action
  startPlayback() {
    const tokens = this.args.model.notation?.split(/\s+/) || [];
    if (tokens.length === 0) return;

    this._isPlaying = true;
    this._isPaused = false;
    this._cancelPlayback = false;
    this._currentTokenIndex = 0;
    this.playbackButtonState = 'pause';

    this.playFromCurrentPosition();
  }

  @action
  pausePlayback() {
    this._isPaused = true;
    this._isPlaying = false;
    this.playbackButtonState = 'resume';
    console.log(`Playback paused at token index: ${this._currentTokenIndex}`);
  }

  @action
  resumePlayback() {
    if (!this._isPaused) return;

    this._isPlaying = true;
    this._isPaused = false;
    this._cancelPlayback = false;
    this.playbackButtonState = 'pause';

    console.log(
      `Resuming playback from token index: ${this._currentTokenIndex}`,
    );
    this.playFromCurrentPosition();
  }

  @action
  async playFromCurrentPosition() {
    const tokens = this.args.model.notation?.split(/\s+/) || [];

    if (!this.audioContext) {
      this.audioContext = new AudioContext();
    }

    if (this.audioContext.state === 'suspended') {
      try {
        await this.audioContext.resume();
        console.log('Audio context resumed successfully');
        this.audioReady = true;
      } catch (error) {
        console.error('Failed to resume audio context:', error);
        this._isPlaying = false;
        this.audioReady = false;
        return;
      }
    }

    console.log(`Playing from token index: ${this._currentTokenIndex}`);

    for (let i = this._currentTokenIndex; i < tokens.length; i++) {
      if (this._cancelPlayback) break;

      if (this._isPaused) {
        this._currentTokenIndex = i;
        console.log(`Playback paused at token index: ${i}`);
        return;
      }

      const token = tokens[i];
      this._currentTokenIndex = i;

      if (token.startsWith('---')) {
        console.log('Long rest (1000ms)');
        await new Promise((r) => setTimeout(r, 1000));
      } else if (token.startsWith('--')) {
        console.log('Medium rest (500ms)');
        await new Promise((r) => setTimeout(r, 500));
      } else if (token.startsWith('-')) {
        console.log('Short rest (250ms)');
        await new Promise((r) => setTimeout(r, 250));
      } else {
        const parsed = this.parseNote(token);
        if (parsed) {
          console.log(`Playing note: ${parsed.note}${parsed.octave}`);
          this.playSingleNote(parsed.note, parsed.octave, 0.8);
          await new Promise((r) => setTimeout(r, 300));
        } else {
          console.warn(`Could not parse note: ${token}`);
        }
      }
    }

    // Only reset state if playback completed normally (not paused or cancelled)
    if (!this._cancelPlayback && !this._isPaused) {
      this._isPlaying = false;
      this._isPaused = false;
      this._currentTokenIndex = 0;
      this.playbackButtonState = 'play';
      console.log('Playback completed');
    } else if (this._cancelPlayback) {
      // If cancelled, reset everything
      this._isPlaying = false;
      this._isPaused = false;
      this._currentTokenIndex = 0;
      this.playbackButtonState = 'play';
      console.log('Playback cancelled');
    }
  }

  @action
  stopPlayback() {
    this._cancelPlayback = true;
    this._isPlaying = false;
    this._isPaused = false;
    this._currentTokenIndex = 0;
    this.playbackButtonState = 'play';
    console.log('Playback stopped and reset');
  }

  @action
  activateAndPlay(note: string, octave: number) {
    this.playNote(note, octave);
    this.setPianoKeyActive(note, octave, true);

    if (this.isRecording) {
      const timestamp = Date.now() - this.recordingStartTime;
      this.recordedNotes.push({
        note: note,
        octave: octave,
        timestamp: timestamp,
      });
    }

    setTimeout(() => {
      this.setPianoKeyActive(note, octave, false);
    }, 200);
  }

  @action
  handleMouseLeave() {
    // Reset piano focus when mouse leaves the compact-stage area
    if (this.pianoFocused) {
      this.pianoFocused = false;
      this.pressedKeys.clear();
      this.isRecording = false;
      this.showNotationTranslation = false;

      // Stop any ongoing playback
      if (this._isPlaying || this._isPaused) {
        this.stopPlayback();
      }

      // Clean up audio
      this.cleanupAudio();
    }
  }

  @action
  togglePianoFocus() {
    this.pianoFocused = !this.pianoFocused;

    if (this.pianoFocused) {
      const piano = document.querySelector('.main-piano') as HTMLElement;
      if (piano) {
        piano.focus();
      }
      this.initializeAudioContext();

      if (this._isPlaying || this._isPaused) {
        this.stopPlayback();
        console.log('Playback stopped when focusing piano');
      }

      console.log('Piano focused - keyboard mode enabled');
    } else {
      console.log('Piano unfocused - notation mode enabled');
    }
  }

  @action
  initializeAudioContext() {
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
      console.log('Audio context initialized');
    }

    if (this.audioContext.state === 'suspended') {
      this.audioContext
        .resume()
        .then(() => {
          console.log('Audio context resumed on focus');
          this.audioReady = true;
        })
        .catch((error) => {
          console.error('Failed to resume audio context:', error);
          this.audioReady = false;
        });
    } else if (this.audioContext.state === 'running') {
      this.audioReady = true;
    }
  }

  @action
  toggleNotationTranslation() {
    this.showNotationTranslation = !this.showNotationTranslation;
  }

  @action
  toggleRecording() {
    if (this.isRecording) {
      this.stopRecording();
    } else {
      this.startRecording();
    }
  }

  @action
  startRecording() {
    this.isRecording = true;
    this.recordedNotes = [];
    this.recordingStartTime = Date.now();

    if (!this.pianoFocused) {
      this.pianoFocused = true;
      const piano = document.querySelector('.main-piano') as HTMLElement;
      if (piano) {
        piano.focus();
      }
      this.initializeAudioContext();
    }

    console.log('Recording started with keyboard mode enabled');
  }

  @action
  stopRecording() {
    this.isRecording = false;
    const notation = this.convertRecordingToNotation();
    this.args.model.notation = notation;

    this.pianoFocused = false;

    console.log('Recording stopped, notation:', notation);
  }

  convertRecordingToNotation(): string {
    if (this.recordedNotes.length === 0) return '';

    let notation = '';
    let lastTimestamp = 0;

    this.recordedNotes.forEach((recordedNote, index) => {
      if (index > 0) {
        const gap = recordedNote.timestamp - lastTimestamp;
        if (gap > 800) {
          notation += ' --- ';
        } else if (gap > 400) {
          notation += ' -- ';
        } else if (gap > 200) {
          notation += ' - ';
        } else {
          notation += ' ';
        }
      }

      notation += recordedNote.note;
      if (recordedNote.octave !== 4) {
        notation += recordedNote.octave;
      }

      lastTimestamp = recordedNote.timestamp;
    });

    return notation.trim();
  }

  @action
  updateNotation(event: Event) {
    const target = event.target as HTMLTextAreaElement;
    const newValue = target.value;
    const oldValue = this.args.model.notation;
    this.args.model.notation = newValue;

    // If notation is cleared, reset all states
    if (!newValue.trim() || newValue !== oldValue) {
      this.resetAllStates();
      return;
    }
  }

  @action
  resetAllStates() {
    // Stop any ongoing playback
    this._cancelPlayback = true;
    this._isPlaying = false;
    this._isPaused = false;
    this._currentTokenIndex = 0;
    this.playbackButtonState = 'play';

    // Clear recording state
    this.isRecording = false;
    this.recordedNotes = [];
    this.recordingStartTime = 0;

    // Clear pressed keys and visual feedback
    this.pressedKeys.clear();

    // Clear translation display
    this.showNotationTranslation = false;

    // Clear any active key visual states
    document
      .querySelectorAll('.keyboard-pressed, .notation-playing')
      .forEach((key) => {
        key.classList.remove('keyboard-pressed', 'notation-playing');
      });

    console.log('All states reset due to notation clear');
  }

  get isPlayDisabled() {
    return !this.args.model.notation?.trim() || this.pianoFocused;
  }

  get playbackProgress() {
    const tokens = this.args.model.notation?.split(/\s+/) || [];
    if (tokens.length === 0) return 0;
    return Math.round((this._currentTokenIndex / tokens.length) * 100);
  }

  get currentToken() {
    const tokens = this.args.model.notation?.split(/\s+/) || [];
    if (this._currentTokenIndex < tokens.length) {
      return tokens[this._currentTokenIndex];
    }
    return '';
  }

  get notationTokenCount() {
    const tokens = this.args.model.notation?.split(/\s+/) || [];
    return tokens.length;
  }

  get progressWidthStyle() {
    return `width: ${this.playbackProgress}%`;
  }

  get translatedNotation() {
    const notation = this.args.model.notation || '';
    if (!notation.trim()) {
      return 'Enter notation above to see keyboard shortcuts';
    }

    const tokens = notation.trim().split(/\s+/);
    let translation = '';

    for (const token of tokens) {
      if (token.startsWith('---')) {
        translation += ' [LONG PAUSE] ';
      } else if (token.startsWith('--')) {
        translation += ' [MEDIUM PAUSE] ';
      } else if (token.startsWith('-')) {
        translation += ' [SHORT PAUSE] ';
      } else {
        const noteData = this.parseNote(token);
        if (noteData) {
          const keyboardKey = this.getKeyboardKey(
            noteData.note,
            noteData.octave,
          );
          if (keyboardKey) {
            translation += keyboardKey + ' ';
          } else {
            translation += `[${token}?] `;
          }
        }
      }
    }

    return translation.trim() || 'No valid notes found in notation';
  }

  destroy() {
    this.cleanupAudio();
  }

  <template>
    <div
      class='compact-stage'
      {{pianoEventModifier
        this.keyboardListenersEnabled
        this.handleKeyDown
        this.handleKeyUp
        this.cleanupAudio
        this.cleanupAudio
        this.handleMouseLeave
      }}
    >
      <header class='compact-header'>
        <div class='brand-section'>
          <div class='piano-icon'>♫</div>
          <h1 class='hero-title'>Chord Piano</h1>
        </div>
        <div class='hero-description'>3-Octave Range | Real-Time Notation</div>
        {{#if this.pianoFocused}}
          <div class='focus-tip'>
            <span class='tip-icon'>🎹</span>
            <span class='tip-text'>Keyboard mode active - Press keys to play
              notes</span>
          </div>
        {{else if this.isRecording}}
          <div class='record-tip'>
            <span class='tip-icon'>⏺</span>
            <span class='tip-text'>Recording mode - Play notes to capture
              notation</span>
          </div>
        {{else}}
          <div class='default-tip'>
            <span class='tip-icon'>💡</span>
            <span class='tip-text'>Click "Focus Piano" to test keyboard or
              "Record" to capture notation</span>
          </div>
        {{/if}}
      </header>

      {{#if this.isRecording}}
        <div class='recording-indicator'>
          <div class='recording-dot'></div>
          <span>Recording... Press keys to record notation</span>
        </div>
      {{/if}}

      <div
        class='main-piano {{if this.pianoFocused "focused"}}'
        tabindex='0'
        role='application'
        aria-label='Piano keyboard'
      >
        <div class='piano-keys' role='group' aria-label='Piano keys'>
          <button
            type='button'
            class='key white'
            data-note='C'
            data-octave='3'
            {{on 'click' (fn this.activateAndPlay 'C' 3)}}
            aria-label='Play C3 note'
          >
            <div class='note-label'>C3</div>
            <span class='key-label'>Q</span>
          </button>
          <button
            type='button'
            class='key black'
            data-note='C#'
            data-octave='3'
            {{on 'click' (fn this.activateAndPlay 'C#' 3)}}
            aria-label='Play C#3 note'
          >
            <div class='black-labels'>
              <div class='note-label'>C#3</div>
              <div class='key-label'>2</div>
            </div>
          </button>
          <button
            type='button'
            class='key white'
            data-note='D'
            data-octave='3'
            {{on 'click' (fn this.activateAndPlay 'D' 3)}}
          >
            <div class='note-label'>D3</div>
            <span class='key-label'>W</span>
          </button>
          <button
            type='button'
            class='key black'
            data-note='D#'
            data-octave='3'
            {{on 'click' (fn this.activateAndPlay 'D#' 3)}}
          >
            <div class='black-labels'>
              <div class='note-label'>D#3</div>
              <div class='key-label'>3</div>
            </div>
          </button>
          <button
            type='button'
            class='key white'
            data-note='E'
            data-octave='3'
            {{on 'click' (fn this.activateAndPlay 'E' 3)}}
          >
            <div class='note-label'>E3</div>
            <span class='key-label'>E</span>
          </button>
          <button
            type='button'
            class='key white'
            data-note='F'
            data-octave='3'
            {{on 'click' (fn this.activateAndPlay 'F' 3)}}
          >
            <div class='note-label'>F3</div>
            <span class='key-label'>R</span>
          </button>
          <button
            type='button'
            class='key black'
            data-note='F#'
            data-octave='3'
            {{on 'click' (fn this.activateAndPlay 'F#' 3)}}
          >
            <div class='black-labels'>
              <div class='note-label'>F#3</div>
              <div class='key-label'>5</div>
            </div>
          </button>
          <button
            type='button'
            class='key white'
            data-note='G'
            data-octave='3'
            {{on 'click' (fn this.activateAndPlay 'G' 3)}}
          >
            <div class='note-label'>G3</div>
            <span class='key-label'>T</span>
          </button>
          <button
            type='button'
            class='key black'
            data-note='G#'
            data-octave='3'
            {{on 'click' (fn this.activateAndPlay 'G#' 3)}}
          >
            <div class='black-labels'>
              <div class='note-label'>G#3</div>
              <div class='key-label'>6</div>
            </div>
          </button>
          <button
            type='button'
            class='key white'
            data-note='A'
            data-octave='3'
            {{on 'click' (fn this.activateAndPlay 'A' 3)}}
          >
            <div class='note-label'>A3</div>
            <span class='key-label'>Y</span>
          </button>
          <button
            type='button'
            class='key black'
            data-note='A#'
            data-octave='3'
            {{on 'click' (fn this.activateAndPlay 'A#' 3)}}
          >
            <div class='black-labels'>
              <div class='note-label'>A#3</div>
              <div class='key-label'>7</div>
            </div>
          </button>
          <button
            type='button'
            class='key white'
            data-note='B'
            data-octave='3'
            {{on 'click' (fn this.activateAndPlay 'B' 3)}}
          >
            <div class='note-label'>B3</div>
            <span class='key-label'>U</span>
          </button>

          <button
            type='button'
            class='key white'
            data-note='C'
            data-octave='4'
            {{on 'click' (fn this.activateAndPlay 'C' 4)}}
          >
            <div class='note-label'>C</div>
            <span class='key-label'>I</span>
          </button>
          <button
            type='button'
            class='key black'
            data-note='C#'
            data-octave='4'
            {{on 'click' (fn this.activateAndPlay 'C#' 4)}}
          >
            <div class='black-labels'>
              <div class='note-label'>C#</div>
              <div class='key-label'>9</div>
            </div>
          </button>
          <button
            type='button'
            class='key white'
            data-note='D'
            data-octave='4'
            {{on 'click' (fn this.activateAndPlay 'D' 4)}}
          >
            <div class='note-label'>D</div>
            <span class='key-label'>O</span>
          </button>
          <button
            type='button'
            class='key black'
            data-note='D#'
            data-octave='4'
            {{on 'click' (fn this.activateAndPlay 'D#' 4)}}
          >
            <div class='black-labels'>
              <div class='note-label'>D#</div>
              <div class='key-label'>0</div>
            </div>
          </button>
          <button
            type='button'
            class='key white'
            data-note='E'
            data-octave='4'
            {{on 'click' (fn this.activateAndPlay 'E' 4)}}
          >
            <div class='note-label'>E</div>
            <span class='key-label'>P</span>
          </button>
          <button
            type='button'
            class='key white'
            data-note='F'
            data-octave='4'
            {{on 'click' (fn this.activateAndPlay 'F' 4)}}
          >
            <div class='note-label'>F</div>
            <span class='key-label'>Z</span>
          </button>
          <button
            type='button'
            class='key black'
            data-note='F#'
            data-octave='4'
            {{on 'click' (fn this.activateAndPlay 'F#' 4)}}
          >
            <div class='black-labels'>
              <div class='note-label'>F#</div>
              <div class='key-label'>S</div>
            </div>
          </button>
          <button
            type='button'
            class='key white'
            data-note='G'
            data-octave='4'
            {{on 'click' (fn this.activateAndPlay 'G' 4)}}
          >
            <div class='note-label'>G</div>
            <span class='key-label'>X</span>
          </button>
          <button
            type='button'
            class='key black'
            data-note='G#'
            data-octave='4'
            {{on 'click' (fn this.activateAndPlay 'G#' 4)}}
          >
            <div class='black-labels'>
              <div class='note-label'>G#</div>
              <div class='key-label'>D</div>
            </div>
          </button>
          <button
            type='button'
            class='key white'
            data-note='A'
            data-octave='4'
            {{on 'click' (fn this.activateAndPlay 'A' 4)}}
          >
            <div class='note-label'>A</div>
            <span class='key-label'>C</span>
          </button>
          <button
            type='button'
            class='key black'
            data-note='A#'
            data-octave='4'
            {{on 'click' (fn this.activateAndPlay 'A#' 4)}}
          >
            <div class='black-labels'>
              <div class='note-label'>A#</div>
              <div class='key-label'>F</div>
            </div>
          </button>
          <button
            type='button'
            class='key white'
            data-note='B'
            data-octave='4'
            {{on 'click' (fn this.activateAndPlay 'B' 4)}}
          >
            <div class='note-label'>B</div>
            <span class='key-label'>V</span>
          </button>

          <button
            type='button'
            class='key white'
            data-note='C'
            data-octave='5'
            {{on 'click' (fn this.activateAndPlay 'C' 5)}}
          >
            <div class='note-label'>C5</div>
            <span class='key-label'>B</span>
          </button>
          <button
            type='button'
            class='key black'
            data-note='C#'
            data-octave='5'
            {{on 'click' (fn this.activateAndPlay 'C#' 5)}}
          >
            <div class='black-labels'>
              <div class='note-label'>C#5</div>
              <div class='key-label'>H</div>
            </div>
          </button>
          <button
            type='button'
            class='key white'
            data-note='D'
            data-octave='5'
            {{on 'click' (fn this.activateAndPlay 'D' 5)}}
          >
            <div class='note-label'>D5</div>
            <span class='key-label'>N</span>
          </button>
          <button
            type='button'
            class='key black'
            data-note='D#'
            data-octave='5'
            {{on 'click' (fn this.activateAndPlay 'D#' 5)}}
          >
            <div class='black-labels'>
              <div class='note-label'>D#5</div>
              <div class='key-label'>J</div>
            </div>
          </button>
          <button
            type='button'
            class='key white'
            data-note='E'
            data-octave='5'
            {{on 'click' (fn this.activateAndPlay 'E' 5)}}
          >
            <div class='note-label'>E5</div>
            <span class='key-label'>M</span>
          </button>
          <button
            type='button'
            class='key white'
            data-note='F'
            data-octave='5'
            {{on 'click' (fn this.activateAndPlay 'F' 5)}}
          >
            <div class='note-label'>F5</div>
            <span class='key-label'>,</span>
          </button>
          <button
            type='button'
            class='key black'
            data-note='F#'
            data-octave='5'
            {{on 'click' (fn this.activateAndPlay 'F#' 5)}}
          >
            <div class='black-labels'>
              <div class='note-label'>F#5</div>
              <div class='key-label'>L</div>
            </div>
          </button>
          <button
            type='button'
            class='key white'
            data-note='G'
            data-octave='5'
            {{on 'click' (fn this.activateAndPlay 'G' 5)}}
          >
            <div class='note-label'>G5</div>
            <span class='key-label'>.</span>
          </button>
          <button
            type='button'
            class='key black'
            data-note='G#'
            data-octave='5'
            {{on 'click' (fn this.activateAndPlay 'G#' 5)}}
          >
            <div class='black-labels'>
              <div class='note-label'>G#5</div>
              <div class='key-label'>;</div>
            </div>
          </button>
          <button
            type='button'
            class='key white'
            data-note='A'
            data-octave='5'
            {{on 'click' (fn this.activateAndPlay 'A' 5)}}
          >
            <div class='note-label'>A5</div>
            <span class='key-label'>/</span>
          </button>
          <button
            type='button'
            class='key black'
            data-note='A#'
            data-octave='5'
            {{on 'click' (fn this.activateAndPlay 'A#' 5)}}
          >
            <div class='black-labels'>
              <div class='note-label'>A#5</div>
              <div class='key-label'>'</div>
            </div>
          </button>
          <button
            type='button'
            class='key white'
            data-note='B'
            data-octave='5'
            {{on 'click' (fn this.activateAndPlay 'B' 5)}}
          >
            <div class='note-label'>B5</div>
            <span class='key-label'>]</span>
          </button>
        </div>
      </div>

      <div class='control-panel'>
        <div class='primary-controls'>
          <button
            {{on 'click' this.togglePianoFocus}}
            class='focus-btn {{if this.pianoFocused "active"}}'
            type='button'
          >
            🎹
            {{if this.pianoFocused 'Unfocus' 'Focus'}}
            Piano
          </button>
          <button
            {{on 'click' this.toggleNotationTranslation}}
            class='control-btn {{if this.showNotationTranslation "active"}}'
            type='button'
            aria-label='Show notation translation'
          >
            📋 Translate
          </button>
          <button
            {{on 'click' this.playNotation}}
            class='control-btn {{if this.pianoFocused "disabled"}}'
            disabled={{this.isPlayDisabled}}
            type='button'
            aria-label='Play/pause notation'
          >
            {{this.buttonIcon}}
            {{this.buttonText}}
            {{if this.pianoFocused ' (Disabled)'}}
          </button>
          <button
            {{on 'click' this.stopPlayback}}
            class='control-btn {{if this.pianoFocused "disabled"}}'
            disabled={{this.isPlayDisabled}}
            type='button'
            aria-label='Stop playback'
          >
            ⏹ Stop
          </button>
          <button
            {{on 'click' this.toggleRecording}}
            class='control-btn {{if this.isRecording "recording"}}'
            type='button'
            aria-label='Record notation'
          >
            {{if this.isRecording '⏹' '⏺'}}
            {{if this.isRecording 'Stop' 'Record'}}
          </button>
        </div>
      </div>

      {{#if this.showNotationTranslation}}
        <div class='translation-panel'>
          <div class='translation-text'>{{this.translatedNotation}}</div>
        </div>
      {{/if}}

      <div class='notation-panel'>
        {{#if this.isPlaying}}
          <div class='playback-progress'>
            <div class='progress-bar'>
              <div
                class='progress-fill'
                style={{this.progressWidthStyle}}
              ></div>
            </div>
            <div class='progress-text'>
              {{this.currentTokenIndex}}
              /
              {{this.notationTokenCount}}
              tokens -
              {{this.currentToken}}
            </div>
          </div>
        {{/if}}
        <label for='notation-input' class='sr-only'>Enter notation</label>
        <textarea
          id='notation-input'
          placeholder='Enter notation...'
          value={{@model.notation}}
          {{on 'input' this.updateNotation}}
          class='notation-input {{if this.pianoFocused "disabled"}}'
          disabled={{this.pianoFocused}}
        ></textarea>
      </div>
    </div>
    <style scoped>
      /* Compact Professional Design */
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

      .compact-stage {
        width: 100%;
        height: 100%;
        max-height: 90vh;
        background: linear-gradient(
          135deg,
          #0f0f23 0%,
          #1a1a2e 50%,
          #16213e 100%
        );
        overflow: hidden;
        display: flex;
        flex-direction: column;
        font-family:
          'Inter',
          -apple-system,
          BlinkMacSystemFont,
          sans-serif;
        padding: 1rem;
        box-sizing: border-box;
      }

      /* Compact Header */
      .compact-header {
        background: rgba(255, 255, 255, 0.08);
        backdrop-filter: blur(20px);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 12px;
        padding: 1rem;
        margin-bottom: 1rem;
        text-align: center;
      }

      .brand-section {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.75rem;
        margin-bottom: 0.5rem;
      }

      .piano-icon {
        font-size: 1.25rem;
        background: linear-gradient(135deg, #667eea, #764ba2);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
      }

      .hero-title {
        font-size: 1.5rem;
        font-weight: 600;
        color: rgba(255, 255, 255, 0.95);
        margin: 0;
        letter-spacing: -0.01em;
      }

      .hero-description {
        font-size: 0.875rem;
        color: rgba(255, 255, 255, 0.7);
        line-height: 1.4;
        margin-bottom: 0.75rem;
      }

      /* Tips */
      .focus-tip,
      .record-tip,
      .default-tip {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        padding: 0.5rem 1rem;
        border-radius: 8px;
        font-size: 0.875rem;
        font-weight: 500;
        animation: slideIn 0.3s ease-out;
      }

      .focus-tip {
        background: rgba(102, 126, 234, 0.2);
        color: #667eea;
        border: 1px solid rgba(102, 126, 234, 0.3);
      }

      .record-tip {
        background: rgba(255, 71, 87, 0.2);
        color: #ff4757;
        border: 1px solid rgba(255, 71, 87, 0.3);
        animation: pulse 2s infinite;
      }

      .default-tip {
        background: rgba(102, 126, 234, 0.2);
        color: #667eea;
        border: 1px solid rgba(102, 126, 234, 0.3);
      }

      .tip-icon {
        font-size: 1rem;
      }

      .tip-text {
        font-weight: 500;
      }

      /* Screen reader only */
      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }

      /* Main Piano */
      .main-piano {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        margin: clamp(1rem, 2vh, 2rem) 0;
        outline: none;
        transition: transform 200ms cubic-bezier(0.23, 1, 0.32, 1);
        /* Responsive container */
        min-height: 200px;
        max-height: 80vh;
      }

      .main-piano.focused {
        transform: scale(1.03);
      }

      .piano-keys {
        display: flex;
        position: relative;
        height: 140px;
        background: linear-gradient(180deg, #fafafa 0%, #f0f0f0 100%);
        border-radius: 8px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
        overflow: hidden;
        /* Responsive sizing */
        min-height: 120px;
        max-height: 200px;
        height: clamp(120px, 20vh, 200px);
      }

      /* Responsive key sizing */
      .white {
        width: clamp(28px, 3.5vw, 45px);
        height: 100%;
        background: linear-gradient(180deg, #ffffff 0%, #f8f9fa 100%);
        border-right: 1px solid rgba(0, 0, 0, 0.1);
        z-index: 1;
      }

      .black {
        width: clamp(18px, 2.2vw, 28px);
        height: 85px;
        background: linear-gradient(180deg, #2c3e50 0%, #1a252f 100%);
        position: relative;
        z-index: 2;
        margin-left: clamp(-20px, -1.8vw, -22px);
        transform: translateX(clamp(10px, 0.6vw, 8px));
        border-radius: 0 0 3px 3px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
      }

      .key {
        border: none;
        cursor: pointer;
        transition: all 80ms cubic-bezier(0.23, 1, 0.32, 1);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: space-between;
        padding: clamp(0.25rem, 0.4vh, 0.5rem) clamp(0.1rem, 0.15vw, 0.2rem);
        position: relative;
        overflow: hidden;
      }

      .white {
        border-right: 1px solid rgba(0, 0, 0, 0.1);
      }

      .white:hover {
        background: linear-gradient(180deg, #f8f9fa 0%, #e9ecef 100%);
      }

      .white:active,
      .white.keyboard-pressed {
        background: linear-gradient(180deg, #667eea 0%, #764ba2 100%);
        color: white;
        box-shadow: inset 0 2px 8px rgba(0, 0, 0, 0.2);
      }

      .white.notation-playing {
        background: linear-gradient(180deg, #667eea 0%, #764ba2 100%);
        color: white;
        box-shadow: inset 0 2px 8px rgba(0, 0, 0, 0.2);
        animation: notationGlow 0.8s ease-out;
      }

      .black:hover {
        background: linear-gradient(180deg, #34495e 0%, #2c3e50 100%);
      }

      .black:active,
      .black.keyboard-pressed {
        background: linear-gradient(180deg, #667eea 0%, #764ba2 100%);
      }

      .black.notation-playing {
        background: linear-gradient(180deg, #667eea 0%, #764ba2 100%);
        animation: notationGlow 0.8s ease-out;
      }

      /* Key Labels */
      .white .note-label {
        font-size: clamp(0.5rem, 0.4vw, 0.6rem);
        font-weight: 600;
        color: #667eea;
        user-select: none;
        line-height: 1;
      }

      .white .key-label {
        font-size: clamp(0.5rem, 0.5vw, 0.7rem);
        font-weight: 500;
        color: rgba(0, 0, 0, 0.5);
        user-select: none;
      }

      .black-labels {
        display: flex;
        flex-direction: column;
        align-items: center;
        height: 100%;
        gap: 0.125rem;
      }

      .black .note-label {
        font-size: clamp(0.5rem, 0.4vw, 0.6rem);
        font-weight: 600;
        color: rgba(255, 255, 255, 0.9);
        user-select: none;
        line-height: 1;
      }

      .black .key-label {
        font-size: clamp(0.6rem, 0.4vw, 0.6rem);
        font-weight: 500;
        color: black;
        user-select: none;
        margin-top: auto;
        width: 0.7rem;
        height: 0.7rem;
        border-radius: 100px;
        background: white;
      }

      .white:active .key-label,
      .white:active .note-label,
      .white.keyboard-pressed .note-label,
      .white.keyboard-pressed .key-label,
      .white.notation-playing .key-label,
      .white.notation-playing .note-label,
      .black:active .key-label,
      .black:active .note-label,
      .black.keyboard-pressed .note-label,
      .black.keyboard-pressed .key-label,
      .black.notation-playing .key-label,
      .black.notation-playing .note-label {
        color: white;
      }

      /* Control Panel */
      .control-panel {
        background: rgba(255, 255, 255, 0.08);
        backdrop-filter: blur(20px);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 12px;
        padding: 1rem;
        margin-bottom: 1rem;
      }

      .primary-controls,
      .secondary-controls {
        display: flex;
        gap: 0.75rem;
        flex-wrap: wrap;
        justify-content: center;
      }

      .secondary-controls {
        margin-top: 0.75rem;
        padding-top: 0.75rem;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
      }

      .focus-btn,
      .control-btn {
        padding: 0.5rem 1rem;
        border: none;
        border-radius: 8px;
        font-size: 0.875rem;
        font-weight: 500;
        cursor: pointer;
        transition: all 160ms cubic-bezier(0.23, 1, 0.32, 1);
        position: relative;
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }

      .focus-btn {
        background: linear-gradient(135deg, #667eea, #764ba2);
        color: white;
        transition: all 160ms cubic-bezier(0.23, 1, 0.32, 1);
      }

      .focus-btn.active {
        background: linear-gradient(180deg, #667eea 0%, #764ba2 100%);
        transform: scale(1.01);
        box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
      }

      .control-btn {
        background: rgba(255, 255, 255, 0.1);
        color: rgba(255, 255, 255, 0.8);
        border: 1px solid rgba(255, 255, 255, 0.1);
      }

      .control-btn:hover {
        background: rgba(255, 255, 255, 0.15);
        color: rgba(255, 255, 255, 0.95);
      }

      .control-btn.active {
        background: linear-gradient(135deg, #667eea, #764ba2);
        color: white;
      }

      .control-btn.disabled {
        opacity: 0.5;
        cursor: not-allowed;
        background: rgba(255, 255, 255, 0.05);
        color: rgba(255, 255, 255, 0.4);
      }

      .control-btn.disabled:hover {
        background: rgba(255, 255, 255, 0.05);
        color: rgba(255, 255, 255, 0.4);
      }

      .control-btn.recording {
        background: linear-gradient(135deg, #ff4757, #ff3838);
        color: white;
        animation: pulse 1s infinite;
      }

      @keyframes pulse {
        0% {
          box-shadow: 0 0 0 0 rgba(255, 71, 87, 0.7);
        }
        70% {
          box-shadow: 0 0 0 10px rgba(255, 71, 87, 0);
        }
        100% {
          box-shadow: 0 0 0 0 rgba(255, 71, 87, 0);
        }
      }

      /* Recording Indicator */
      .recording-indicator {
        background: linear-gradient(135deg, #ff4757, #ff3838);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 12px;
        padding: 1rem;
        margin-bottom: 1rem;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.75rem;
        animation: slideIn 0.3s ease-out;
      }

      .recording-dot {
        width: 12px;
        height: 12px;
        background: white;
        border-radius: 50%;
        animation: blink 1s infinite;
      }

      .recording-indicator span {
        color: white;
        font-weight: 600;
        font-size: 0.875rem;
      }

      @keyframes slideIn {
        from {
          opacity: 0;
          transform: translateY(-20px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      @keyframes blink {
        0%,
        50% {
          opacity: 1;
        }
        51%,
        100% {
          opacity: 0.3;
        }
      }

      @keyframes notationGlow {
        0% {
          box-shadow: 0 0 5px rgba(102, 126, 234, 0.5);
        }
        50% {
          box-shadow: 0 0 15px rgba(102, 126, 234, 0.8);
        }
        100% {
          box-shadow: inset 0 2px 8px rgba(0, 0, 0, 0.2);
        }
      }

      /* Translation Panel */
      .translation-panel {
        background: rgba(255, 255, 0, 0.1);
        border: 1px solid rgba(255, 255, 0, 0.2);
        border-radius: 12px;
        padding: 1rem;
        margin-bottom: 1rem;
        max-height: 250px;
        overflow-y: auto;
      }

      .translation-text {
        color: rgba(255, 255, 255, 0.9);
        font-family: 'Courier New', monospace;
        font-size: 0.875rem;
        line-height: 1.5;
        word-wrap: break-word;
        white-space: pre-wrap;
      }

      /* Notation Panel */
      .notation-panel {
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 12px;
        padding: 1rem;
      }

      .notation-input {
        width: 100%;
        height: 60px;
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 8px;
        padding: 0.75rem;
        color: rgba(255, 255, 255, 0.9);
        font-family: 'Courier New', monospace;
        font-size: 0.875rem;
        resize: none;
        outline: none;
        box-sizing: border-box;
      }

      .notation-input::placeholder {
        color: rgba(255, 255, 255, 0.5);
      }

      .notation-input:focus {
        border-color: #667eea;
        box-shadow: 0 0 0 2px rgba(102, 126, 234, 0.2);
      }

      .notation-input.disabled {
        opacity: 0.5;
        cursor: not-allowed;
        background: rgba(255, 255, 255, 0.05);
        border-color: rgba(255, 255, 255, 0.1);
      }

      .notation-input.disabled:focus {
        border-color: rgba(255, 255, 255, 0.1);
        box-shadow: none;
      }

      /* Playback Progress */
      .playback-progress {
        margin-bottom: 1rem;
        padding: 0.75rem;
        background: rgba(102, 126, 234, 0.1);
        border: 1px solid rgba(102, 126, 234, 0.2);
        border-radius: 8px;
      }

      .progress-bar {
        width: 100%;
        height: 8px;
        background: rgba(255, 255, 255, 0.1);
        border-radius: 4px;
        overflow: hidden;
        margin-bottom: 0.5rem;
      }

      .progress-fill {
        height: 100%;
        background: linear-gradient(90deg, #667eea, #764ba2);
        border-radius: 4px;
        transition: width 0.3s ease;
      }

      .progress-text {
        font-size: 0.75rem;
        color: rgba(255, 255, 255, 0.8);
        text-align: center;
        font-family: 'Courier New', monospace;
      }
    </style>
  </template>
}

export class Piano extends CardDef {
  static displayName = 'Piano';
  static prefersWideFormat = true;
  @field notation = contains(StringField);

  static isolated = IsolatedPianoTemplate;

  static fitted = class Fitted extends Component<typeof this> {
    <template>
      <div class='fitted-container'>
        <div class='badge-format'>
          <div class='badge-content'>
            <div class='badge-icon'>
              <div class='piano-keys-mini'>
                <div class='key-mini white'></div>
                <div class='key-mini black'></div>
                <div class='key-mini white'></div>
                <div class='key-mini black'></div>
                <div class='key-mini white'></div>
              </div>
            </div>
            <div class='badge-info'>
              <div class='badge-title'>Piano</div>
              <div class='badge-stats'>3 Octaves • Live</div>
            </div>
          </div>
        </div>

        <div class='strip-format'>
          <div class='strip-content'>
            <div class='strip-visual'>
              <div class='piano-strip'>
                <div class='strip-key white'></div>
                <div class='strip-key black'></div>
                <div class='strip-key white'></div>
                <div class='strip-key black'></div>
                <div class='strip-key white'></div>
                <div class='strip-key white'></div>
                <div class='strip-key black'></div>
                <div class='strip-key white'></div>
                <div class='strip-key black'></div>
                <div class='strip-key white'></div>
              </div>
            </div>
            <div class='strip-info'>
              <div class='strip-title'>Piano Keyboard</div>
              <div class='strip-description'>{{if
                  @model.notation
                  'Has notation'
                  'Ready to play'
                }}
                • Real-time synthesis</div>
            </div>
            <div class='strip-badge'>
              <div class='sound-indicator'></div>
              AUDIO
            </div>
          </div>
        </div>

        <div class='tile-format'>
          <div class='tile-header'>
            <div class='tile-visual'>
              <div class='piano-keyboard'>
                <div class='keyboard-row'>
                  <div class='key-tile white'></div>
                  <div class='key-tile black'></div>
                  <div class='key-tile white'></div>
                  <div class='key-tile black'></div>
                  <div class='key-tile white'></div>
                  <div class='key-tile white'></div>
                  <div class='key-tile black'></div>
                  <div class='key-tile white'></div>
                </div>
                <div class='keyboard-glow'></div>
              </div>
            </div>
          </div>
          <div class='tile-content'>
            <h3 class='tile-title'>Piano Keyboard</h3>
            <div class='tile-specs'>
              <div class='spec-row'>
                <span class='spec-label'>Range:</span>
                <span class='spec-value'>C3 - B5</span>
              </div>
              <div class='spec-row'>
                <span class='spec-label'>Keys:</span>
                <span class='spec-value'>37 Keys</span>
              </div>
              <div class='spec-row'>
                <span class='spec-label'>Mode:</span>
                <span class='spec-value'>{{if
                    @model.notation
                    'Notation'
                    'Interactive'
                  }}</span>
              </div>
            </div>
            <div class='tile-features'>
              <div class='feature-tag'>Real-time</div>
              <div class='feature-tag'>Record</div>
              <div class='feature-tag'>Play</div>
            </div>
          </div>
        </div>

        <div class='card-format'>
          <div class='card-header'>
            <div class='card-info'>
              <h3 class='card-title'>Piano Keyboard</h3>
              <p class='card-description'>Professional 3-octave virtual piano
                with real-time audio synthesis and notation recording</p>
            </div>
            <div class='card-visual'>
              <div class='piano-display'>
                <div class='display-screen'>
                  <div class='display-line'>
                    <span class='param-label'>RANGE</span>
                    <span class='param-value'>C3-B5</span>
                  </div>
                  <div class='display-line'>
                    <span class='param-label'>MODE</span>
                    <span class='param-value'>{{if
                        @model.notation
                        'NOTATION'
                        'LIVE'
                      }}</span>
                  </div>
                </div>
                <div class='piano-controls'>
                  <div class='control-led active'></div>
                  <div class='control-led'></div>
                  <div class='control-led active'></div>
                </div>
              </div>
            </div>
          </div>
          <div class='card-keyboard'>
            <div class='keyboard-preview'>
              <div class='key-preview white'></div>
              <div class='key-preview black'></div>
              <div class='key-preview white'></div>
              <div class='key-preview black'></div>
              <div class='key-preview white'></div>
              <div class='key-preview white'></div>
              <div class='key-preview black'></div>
              <div class='key-preview white'></div>
              <div class='key-preview black'></div>
              <div class='key-preview white'></div>
              <div class='key-preview black'></div>
              <div class='key-preview white'></div>
            </div>
          </div>
          <div class='card-features'>
            <div class='features-label'>Capabilities:</div>
            <div class='feature-list'>
              <div class='feature-pill'>Real-time Audio</div>
              <div class='feature-pill'>Keyboard Input</div>
              <div class='feature-pill'>Notation Recording</div>
              <div class='feature-pill'>Playback Engine</div>
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
          background: linear-gradient(135deg, #0f0f23 0%, #1a1a2e 100%);
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
        }

        .piano-keys-mini {
          display: flex;
          gap: 1px;
          background: #1a1a2e;
          border-radius: 3px;
          padding: 2px;
        }

        .key-mini {
          border-radius: 1px;
        }

        .key-mini.white {
          width: 3px;
          height: 16px;
          background: #f8f9fa;
        }

        .key-mini.black {
          width: 2px;
          height: 10px;
          background: #2c3e50;
          margin-top: 0;
        }

        .badge-info {
          flex: 1;
          min-width: 0;
        }

        .badge-title {
          font-size: 0.75rem;
          font-weight: 700;
          color: #667eea;
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

        .piano-strip {
          display: flex;
          gap: 1px;
          align-items: flex-end;
          height: 24px;
          background: #1a1a2e;
          border-radius: 4px;
          padding: 2px;
        }

        .strip-key {
          border-radius: 1px;
        }

        .strip-key.white {
          width: 3px;
          height: 20px;
          background: #f8f9fa;
        }

        .strip-key.black {
          width: 2px;
          height: 14px;
          background: #2c3e50;
          margin-top: 6px;
        }

        .strip-info {
          flex: 1;
          min-width: 0;
        }

        .strip-title {
          font-size: 0.875rem;
          font-weight: 700;
          color: #667eea;
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

        .sound-indicator {
          width: 6px;
          height: 6px;
          background: #8b5cf6;
          border-radius: 50%;
          animation: audio-pulse 1.5s ease-in-out infinite;
        }

        @keyframes audio-pulse {
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
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 1rem;
          border-radius: 8px;
          overflow: hidden;
        }

        .piano-keyboard {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .keyboard-row {
          display: flex;
          gap: 1px;
          align-items: flex-end;
          background: #1a1a2e;
          border-radius: 4px;
          padding: 3px;
        }

        .key-tile {
          border-radius: 2px;
        }

        .key-tile.white {
          width: 4px;
          height: 24px;
          background: rgba(255, 255, 255, 0.9);
        }

        .key-tile.black {
          width: 3px;
          height: 16px;
          background: rgba(44, 62, 80, 0.9);
          margin-top: 0;
        }

        .keyboard-glow {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: radial-gradient(
            circle at center,
            rgba(255, 255, 255, 0.1) 0%,
            transparent 70%
          );
          pointer-events: none;
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
          color: #667eea;
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
          color: #667eea;
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
          background: rgba(102, 126, 234, 0.2);
          border: 1px solid #667eea;
          color: #667eea;
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
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
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

        .piano-display {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          padding: 0.75rem;
          background: rgba(15, 15, 35, 0.7);
          backdrop-filter: blur(8px);
          border-radius: 8px;
          min-width: 120px;
        }

        .display-screen {
          background: #0f0f23;
          padding: 0.5rem;
          border-radius: 4px;
          border: 1px solid rgba(102, 126, 234, 0.3);
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
          color: #667eea;
          font-weight: 700;
          font-family: 'JetBrains Mono', monospace;
        }

        .piano-controls {
          display: flex;
          justify-content: space-between;
          gap: 0.25rem;
        }

        .control-led {
          width: 8px;
          height: 8px;
          background: #374151;
          border: 1px solid #667eea;
          border-radius: 50%;
          transition: all 0.3s ease;
        }

        .control-led.active {
          background: #667eea;
          box-shadow: 0 0 8px rgba(102, 126, 234, 0.6);
        }

        .card-keyboard {
          background: rgba(248, 250, 252, 0.1);
          border-radius: 8px;
          padding: 1rem;
          margin-bottom: 1rem;
        }

        .keyboard-preview {
          display: flex;
          gap: 1px;
          align-items: flex-end;
          height: 40px;
          background: #1a1a2e;
          border-radius: 6px;
          padding: 4px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        }

        .key-preview {
          border-radius: 2px;
          transition: all 0.3s ease;
        }

        .key-preview.white {
          width: 8px;
          height: 32px;
          background: linear-gradient(180deg, #ffffff 0%, #f8f9fa 100%);
          border-right: 1px solid rgba(0, 0, 0, 0.1);
        }

        .key-preview.black {
          width: 5px;
          height: 20px;
          background: linear-gradient(180deg, #2c3e50 0%, #1a252f 100%);
          margin-left: -3px;
          margin-right: -3px;
          z-index: 2;
          position: relative;
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
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
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
