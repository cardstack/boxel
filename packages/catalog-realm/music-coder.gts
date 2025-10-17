import { not, eq } from '@cardstack/boxel-ui/helpers';
import {
  CardDef,
  Component,
  field,
  contains,
  containsMany,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import TextAreaField from 'https://cardstack.com/base/text-area';
import { tracked } from '@glimmer/tracking';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Modifier from 'ember-modifier';
import MusicIcon from '@cardstack/boxel-icons/music';
import PlayIcon from '@cardstack/boxel-icons/play';
import StopIcon from '@cardstack/boxel-icons/square';
import RefreshIcon from '@cardstack/boxel-icons/refresh-cw';

// Strudel will be dynamically imported to avoid SSR issues

class CanvasModifier extends Modifier {
  modify(
    element: HTMLCanvasElement,
    _positional: never[],
    named: { component: any },
  ) {
    if (named.component) {
      named.component.canvasElement = element;
    }
  }
}

export class MusicCoder extends CardDef {
  static displayName = 'Music Coder';
  static icon = MusicIcon;

  @field title = contains(StringField);
  @field description = contains(TextAreaField);
  @field pattern = contains(TextAreaField);
  @field bpm = contains(NumberField);

  static isolated = class Isolated extends Component<typeof this> {
    @tracked isPlaying = false;
    @tracked errorMessage = '';
    @tracked currentPattern =
      this.args.model.pattern || 'note("60 64 67 72").s("sawtooth")';
    @tracked currentBpm = this.args.model.bpm || 120;
    @tracked isStrudelInitialized = false;

    private strudel!: any;
    private player: { stop: () => void } | null = null;
    private canvasElement: HTMLCanvasElement | null = null;
    private animationFrameId: number | null = null;

    // Pattern presets organized by category
    presets = [
      // Synth Presets
      {
        name: '🎹 Saw Synth Melody',
        pattern: 'note("60 64 67 72").s("sawtooth")',
        category: 'synth',
      },
      {
        name: '🎹 Square Bass',
        pattern: 'note("36 43 48").s("square")',
        category: 'synth',
      },
      {
        name: '🎹 Sine Arpeggio',
        pattern: 'note("c4 e4 g4 c5").s("sine")',
        category: 'synth',
      },
      {
        name: '🎹 Triangle Lead',
        pattern: 'note("60 62 64 65 67").s("triangle")',
        category: 'synth',
      },
      {
        name: '🎹 Sawtooth Chord',
        pattern: 'note("48 52 55 59").s("sawtooth")',
        category: 'synth',
      },

      // Drum Presets
      {
        name: '🥁 Basic Drums',
        pattern: 's("bd sd, hh*4")',
        category: 'drums',
      },
      {
        name: '🥁 Fast Drums',
        pattern: 's("bd sd*2, hh*8")',
        category: 'drums',
      },
      {
        name: '🥁 Syncopated Beat',
        pattern: 's("bd ~ bd sd, hh*8")',
        category: 'drums',
      },
      {
        name: '🥁 Euclidean Rhythm',
        pattern: 's("bd(3,8), sd(5,8,2)")',
        category: 'drums',
      },

      // Full Compositions
      {
        name: '🎼 Simple Mix',
        pattern: 'stack(s("bd sd"), note("c3 eb3").s("sawtooth"))',
        category: 'full',
      },
      {
        name: '🎼 M Theme',
        pattern: `stack(
  // Main melody - the complete theme!
  note("<[e5 e5 ~ e5 ~ c5 e5 ~] [g5 ~ ~ ~ g4 ~ ~ ~] [c5 ~ ~ g4 ~ ~ e4 ~] [a4 ~ b4 ~ bb4 a4 ~ ~] [g4 e5 ~ g5 a5 ~ f5 g5] [~ e5 ~ c5 d5 b4 ~ ~] [c5 ~ ~ g4 ~ ~ e4 ~] [a4 ~ b4 ~ bb4 a4 ~ ~] [g4 e5 ~ g5 a5 ~ f5 g5] [~ e5 ~ c5 d5 b4 ~ ~]>").sound("square").gain(0.5),
  
  // Bass line
  note("<[c3 ~ ~ ~] [g2 ~ ~ ~] [c3 ~ ~ ~] [f2 ~ ~ ~] [c3 ~ ~ ~] [g2 ~ ~ ~] [c3 ~ ~ ~] [f2 ~ ~ ~] [c3 ~ ~ ~] [g2 ~ ~ ~]>").sound("sawtooth").gain(0.4).lpf(600),
  
  // Kick and snare pattern
  s("bd ~ ~ ~, ~ ~ sd ~").gain(0.5),
  
  // Hi-hat for groove
  s("~ hh ~ hh").gain(0.3)
)`,
        category: 'full',
      },
    ];

    get canPlay() {
      return this.currentPattern.trim().length > 0 && this.isStrudelInitialized;
    }

    private async ensureStrudel() {
      if (typeof window === 'undefined') return; // SSR guard
      if (this.strudel) return; // already loaded

      // Dynamic import happens only in the browser
      const mod = await import(
        'https://cdn.jsdelivr.net/npm/@strudel/web@1.2.5/+esm'
      );
      this.strudel = mod as any;
      await this.strudel.initStrudel();

      // Load sample libraries
      const libraries = this.args.model.sampleLibraries || [
        'github:tidalcycles/Dirt-Samples',
      ];
      await Promise.all(
        libraries.map((lib: string) => this.strudel.samples(lib)),
      );

      this.isStrudelInitialized = true;
    }

    private startWaveformVisualization(retryCount = 0) {
      if (!this.canvasElement || !this.strudel?.analysers) {
        return;
      }

      const analyserId = 'music-studio-scope';
      const analyser = this.strudel.analysers[analyserId];

      // The analyser IS the AnalyserNode directly, not wrapped in an object
      if (!analyser) {
        // Retry up to 10 times with increasing delays
        if (retryCount < 10) {
          setTimeout(
            () => {
              this.startWaveformVisualization(retryCount + 1);
            },
            100 * (retryCount + 1),
          );
        }
        return;
      }

      const canvas = this.canvasElement;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const dataArray = new Uint8Array(analyser.fftSize);

      const draw = () => {
        this.animationFrameId = requestAnimationFrame(draw);

        analyser.getByteTimeDomainData(dataArray);

        // Clear canvas with dark background
        ctx.fillStyle = '#18181b';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Draw waveform
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#3b82f6';
        ctx.beginPath();

        const sliceWidth = canvas.width / dataArray.length;
        let x = 0;

        for (let i = 0; i < dataArray.length; i++) {
          const v = dataArray[i] / 255.0;
          const y = v * canvas.height;

          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }

          x += sliceWidth;
        }

        ctx.stroke();
      };

      draw();
    }

    private stopWaveformVisualization() {
      if (this.animationFrameId !== null) {
        cancelAnimationFrame(this.animationFrameId);
        this.animationFrameId = null;
      }

      // Clear canvas
      if (this.canvasElement) {
        const ctx = this.canvasElement.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#18181b';
          ctx.fillRect(
            0,
            0,
            this.canvasElement.width,
            this.canvasElement.height,
          );
        }
      }
    }

    play = async () => {
      try {
        await this.ensureStrudel();
        const { s, note, stack } = this.strudel;

        // Build the pattern from text safely
        const factory = new Function(
          's',
          'note',
          'stack',
          `return (${this.currentPattern})`,
        );
        const pattern = factory(s, note, stack);

        // Stop old player and visualization
        this.player?.stop();
        this.stopWaveformVisualization();

        // Add analyze() to the pattern chain and start with tempo
        const analyserId = 'music-studio-scope';
        this.player = pattern.analyze(analyserId).cpm(this.currentBpm).play();

        this.isPlaying = true;
        this.errorMessage = '';

        // Wait a bit for Strudel to actually create the analyser, then start visualization
        setTimeout(() => {
          this.startWaveformVisualization();
        }, 100);
      } catch (error: any) {
        // Provide helpful error messages
        let errorMsg = error.message || 'Unknown error';

        // Check if it's a "sound not found" error
        if (errorMsg.includes('not found')) {
          const soundMatch = errorMsg.match(/sound (\w+) not found/);
          if (soundMatch) {
            const missingSound = soundMatch[1];
            errorMsg = `Sound "${missingSound}" not available. Try these synths: sawtooth, square, sine, triangle, or these drums: bd, sd, hh, cp`;
          }
        }

        this.errorMessage = errorMsg;
        this.isPlaying = false;
        console.error('Strudel error:', error);
      }
    };

    stop = () => {
      if (this.strudel?.hush) {
        this.strudel.hush();
      }
      this.player = null;
      this.isPlaying = false;
      this.stopWaveformVisualization();
    };

    update = async () => {
      if (!this.isPlaying) {
        // If not playing, just start playing with new pattern
        await this.play();
        return;
      }

      // If already playing, stop and restart with the new pattern
      this.stop();
      await this.play();
    };

    loadPreset = (event: Event) => {
      const target = event.target as HTMLSelectElement;
      const selectedPattern = target.value;
      if (selectedPattern) {
        this.currentPattern = selectedPattern;
        this.args.model.pattern = selectedPattern;
      }
    };

    updatePattern = (event: Event) => {
      const target = event.target as HTMLTextAreaElement;
      this.currentPattern = target.value;
      this.args.model.pattern = target.value;
    };

    updateBpm = (event: Event) => {
      const target = event.target as HTMLInputElement;
      const newBpm = parseInt(target.value, 10);
      this.currentBpm = newBpm;
      this.args.model.bpm = newBpm;

      // Restart with new tempo if playing
      if (this.isPlaying) {
        this.play();
      }
    };

    willDestroy() {
      if (this.strudel?.hush) {
        this.strudel.hush();
      }
      this.stopWaveformVisualization();
      super.willDestroy?.();
    }

    <template>
      <div class='mini-music-studio'>
        <header class='studio-header'>
          <h1>{{if @model.title @model.title 'Live Music Coder'}}</h1>
          {{#if @model.description}}
            <p class='description'>{{@model.description}}</p>
          {{/if}}
        </header>

        <div class='studio-content'>
          <div class='preset-selector'>
            <label for='preset-select'>Pattern Presets</label>
            <select
              id='preset-select'
              class='preset-select'
              {{on 'change' this.loadPreset}}
            >
              <option value=''>-- Select a preset --</option>
              <optgroup label='🎹 Synth Sounds'>
                {{#each this.presets as |preset|}}
                  {{#if (eq preset.category 'synth')}}
                    <option value={{preset.pattern}}>{{preset.name}}</option>
                  {{/if}}
                {{/each}}
              </optgroup>
              <optgroup label='🥁 Drum Patterns'>
                {{#each this.presets as |preset|}}
                  {{#if (eq preset.category 'drums')}}
                    <option value={{preset.pattern}}>{{preset.name}}</option>
                  {{/if}}
                {{/each}}
              </optgroup>
              <optgroup label='🎼 Full Compositions'>
                {{#each this.presets as |preset|}}
                  {{#if (eq preset.category 'full')}}
                    <option value={{preset.pattern}}>{{preset.name}}</option>
                  {{/if}}
                {{/each}}
              </optgroup>
            </select>
          </div>

          <div class='pattern-editor'>
            <label for='pattern-input'>Pattern Code</label>
            <textarea
              id='pattern-input'
              class='pattern-input'
              value={{this.currentPattern}}
              {{on 'input' this.updatePattern}}
              placeholder='note("60 64 67 72").s("sawtooth")'
              rows='6'
            ></textarea>
          </div>

          <div class='controls'>
            <div class='controls-row'>
              <div class='transport-controls'>
                <button
                  class='control-button play-button'
                  {{on 'click' this.play}}
                  disabled={{this.isPlaying}}
                  title='Play'
                >
                  <PlayIcon width='20' height='20' />
                  Play
                </button>

                <button
                  class='control-button stop-button'
                  {{on 'click' this.stop}}
                  disabled={{not this.isPlaying}}
                  title='Stop'
                >
                  <StopIcon width='20' height='20' />
                  Stop
                </button>

                <button
                  class='control-button update-button'
                  {{on 'click' this.update}}
                  disabled={{not this.canPlay}}
                  title='Update pattern'
                >
                  <RefreshIcon width='20' height='20' />
                  Update
                </button>
              </div>

              <div class='bpm-control'>
                <label for='bpm-input'>BPM: {{this.currentBpm}}</label>
                <input
                  id='bpm-input'
                  type='range'
                  min='60'
                  max='200'
                  value={{this.currentBpm}}
                  {{on 'input' this.updateBpm}}
                  class='bpm-slider'
                />
              </div>
            </div>
          </div>

          <div class='waveform-container'>
            <canvas
              class='waveform-canvas'
              width='800'
              height='200'
              {{CanvasModifier component=this}}
            ></canvas>
          </div>

          {{#if this.errorMessage}}
            <div class='error-message'>
              {{this.errorMessage}}
            </div>
          {{/if}}
        </div>
      </div>

      <style scoped>
        .mini-music-studio {
          height: 100%;
          display: flex;
          flex-direction: column;
          background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
          color: #e4e4e7;
          font-family: 'Inter', system-ui, sans-serif;
          padding: 1.5rem;
          overflow-y: auto;
        }

        .studio-header {
          margin-bottom: 1.5rem;
        }

        .studio-header h1 {
          font-size: 1.75rem;
          font-weight: 700;
          margin: 0 0 0.5rem 0;
          color: #f0f0f3;
        }

        .description {
          color: #a1a1aa;
          font-size: 0.875rem;
          margin: 0;
        }

        .loading-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 3rem;
          gap: 1rem;
        }

        .spinner {
          width: 40px;
          height: 40px;
          border: 3px solid #27272a;
          border-top-color: #3b82f6;
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }

        .studio-content {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
          flex: 1;
        }

        .preset-selector {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .preset-selector label {
          font-size: 0.875rem;
          font-weight: 600;
          color: #d4d4d8;
        }

        .preset-select {
          width: 100%;
          padding: 0.625rem;
          background: #18181b;
          border: 1px solid #3f3f46;
          border-radius: 0.375rem;
          color: #f0f0f3;
          font-size: 0.875rem;
          cursor: pointer;
          transition: border-color 0.2s;
        }

        .preset-select:focus {
          outline: none;
          border-color: #3b82f6;
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
        }

        .pattern-editor {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .pattern-editor label {
          font-size: 0.875rem;
          font-weight: 600;
          color: #d4d4d8;
        }

        .pattern-input {
          width: 100%;
          padding: 0.875rem;
          background: #18181b;
          border: 1px solid #3f3f46;
          border-radius: 0.5rem;
          color: #f0f0f3;
          font-family: 'Fira Code', 'Courier New', monospace;
          font-size: 0.875rem;
          line-height: 1.5;
          resize: vertical;
          transition: border-color 0.2s;
        }

        .pattern-input:focus {
          outline: none;
          border-color: #3b82f6;
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
        }

        .controls {
          padding: 1rem;
          background: rgba(24, 24, 27, 0.5);
          border-radius: 0.5rem;
          border: 1px solid #27272a;
        }

        .controls-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 1.5rem;
          flex-wrap: wrap;
        }

        .transport-controls {
          display: flex;
          gap: 0.75rem;
        }

        .control-button {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.625rem 1rem;
          background: #27272a;
          border: 1px solid #3f3f46;
          border-radius: 0.375rem;
          color: #e4e4e7;
          font-size: 0.875rem;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
        }

        .control-button:hover:not(:disabled) {
          background: #3f3f46;
          border-color: #52525b;
        }

        .control-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .play-button:hover:not(:disabled) {
          background: #15803d;
          border-color: #16a34a;
          color: #f0fdf4;
        }

        .stop-button:hover:not(:disabled) {
          background: #b91c1c;
          border-color: #dc2626;
          color: #fef2f2;
        }

        .update-button:hover:not(:disabled) {
          background: #1e40af;
          border-color: #2563eb;
          color: #dbeafe;
        }

        .bpm-control {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          min-width: 200px;
          flex: 1;
          max-width: 300px;
        }

        .bpm-control label {
          font-size: 0.875rem;
          font-weight: 600;
          color: #d4d4d8;
        }

        .bpm-slider {
          width: 100%;
          height: 6px;
          border-radius: 3px;
          background: #27272a;
          outline: none;
          cursor: pointer;
        }

        .bpm-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: #3b82f6;
          cursor: pointer;
          transition: background 0.2s;
        }

        .bpm-slider::-webkit-slider-thumb:hover {
          background: #60a5fa;
        }

        .bpm-slider::-moz-range-thumb {
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: #3b82f6;
          cursor: pointer;
          border: none;
          transition: background 0.2s;
        }

        .bpm-slider::-moz-range-thumb:hover {
          background: #60a5fa;
        }

        .waveform-container {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .waveform-container label {
          font-size: 0.875rem;
          font-weight: 600;
          color: #d4d4d8;
        }

        .waveform-canvas {
          width: 100%;
          height: 200px;
          background: #18181b;
          border: 1px solid #3f3f46;
          border-radius: 0.5rem;
          box-shadow: inset 0 2px 8px rgba(0, 0, 0, 0.3);
        }

        .error-message {
          padding: 0.875rem;
          background: rgba(220, 38, 38, 0.1);
          border: 1px solid #b91c1c;
          border-radius: 0.375rem;
          color: #fca5a5;
          font-size: 0.875rem;
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='music-studio-card'>
        <div class='card-header'>
          <MusicIcon width='20' height='20' class='music-icon' />
          <h3>{{if @model.title @model.title 'Music Studio'}}</h3>
        </div>
        <div class='pattern-preview'>
          <code>{{@model.pattern}}</code>
        </div>
        <div class='card-footer'>
          <span class='bpm-badge'>{{@model.bpm}} BPM</span>
        </div>
      </div>

      <style scoped>
        .music-studio-card {
          padding: 1rem;
          background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
          border-radius: 0.5rem;
          color: #e4e4e7;
        }

        .card-header {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin-bottom: 0.75rem;
        }

        .music-icon {
          color: #3b82f6;
        }

        .card-header h3 {
          margin: 0;
          font-size: 1rem;
          font-weight: 600;
        }

        .pattern-preview {
          padding: 0.75rem;
          background: #18181b;
          border-radius: 0.375rem;
          margin-bottom: 0.75rem;
          overflow-x: auto;
        }

        .pattern-preview code {
          font-family: 'Fira Code', monospace;
          font-size: 0.8125rem;
          color: #a1a1aa;
        }

        .card-footer {
          display: flex;
          justify-content: flex-end;
        }

        .bpm-badge {
          padding: 0.25rem 0.625rem;
          background: #27272a;
          border-radius: 0.25rem;
          font-size: 0.75rem;
          font-weight: 600;
          color: #3b82f6;
        }
      </style>
    </template>
  };
}
