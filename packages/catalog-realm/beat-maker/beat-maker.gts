import {
  CardDef,
  FieldDef,
  field,
  contains,
  linksTo,
  linksToMany,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import MusicIcon from '@cardstack/boxel-icons/music';
import { Button } from '@cardstack/boxel-ui/components';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { fn, get, array, concat } from '@ember/helper';
import { eq, gt, or } from '@cardstack/boxel-ui/helpers';

// ⁸⁹ Drum Kit Definition - stores sound parameters for each kit
export class DrumKitField extends FieldDef {
  static displayName = 'Drum Kit';
  static icon = MusicIcon;

  @field kitName = contains(StringField);
  @field kickParams = contains(StringField); // JSON string of kick sound parameters
  @field snareParams = contains(StringField);
  @field hihatParams = contains(StringField);
  @field openhatParams = contains(StringField);
  @field clapParams = contains(StringField);
  @field crashParams = contains(StringField);

  // ⁹⁰ Parse sound parameters from JSON strings
  get soundParams() {
    try {
      return {
        kick: JSON.parse(
          this.kickParams || '{"type": "808", "frequency": 60, "decay": 0.3}',
        ),
        snare: JSON.parse(
          this.snareParams || '{"type": "808", "frequency": 200, "decay": 0.1}',
        ),
        hihat: JSON.parse(
          this.hihatParams ||
            '{"type": "808", "frequency": 8000, "decay": 0.05}',
        ),
        openhat: JSON.parse(
          this.openhatParams ||
            '{"type": "808", "frequency": 6000, "decay": 0.3}',
        ),
        clap: JSON.parse(
          this.clapParams || '{"type": "808", "frequency": 2000, "decay": 0.1}',
        ),
        crash: JSON.parse(
          this.crashParams ||
            '{"type": "808", "frequency": 3000, "decay": 1.0}',
        ),
      };
    } catch (e) {
      console.error('Error parsing sound parameters:', e);
      return {
        kick: { type: '808', frequency: 60, decay: 0.3 },
        snare: { type: '808', frequency: 200, decay: 0.1 },
        hihat: { type: '808', frequency: 8000, decay: 0.05 },
        openhat: { type: '808', frequency: 6000, decay: 0.3 },
        clap: { type: '808', frequency: 2000, decay: 0.1 },
        crash: { type: '808', frequency: 3000, decay: 1.0 },
      };
    }
  }

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='drum-kit-field'>
        <div class='kit-name'>{{if
            @model.kitName
            @model.kitName
            'Unnamed Kit'
          }}</div>
        <div class='kit-preview'>
          <span class='kit-type'>{{@model.soundParams.kick.type}} Style</span>
        </div>
      </div>

      <style scoped>
        .drum-kit-field {
          padding: 0.5rem;
          border: 1px solid #374151;
          border-radius: var(--radius, var(--boxel-border-radius));
          background: #1e293b;
          color: white;
        }

        .kit-name {
          font-size: 0.75rem;
          font-weight: 600;
          color: #e5e7eb;
          margin-bottom: 0.25rem;
        }

        .kit-type {
          font-size: 0.625rem;
          color: #9ca3af;
          text-transform: uppercase;
        }
      </style>
    </template>
  };
}

// ⁹¹ Drum Kit Card Definition - stores complete drum kits as cards
export class DrumKitCard extends CardDef {
  static displayName = 'Drum Kit';
  static icon = MusicIcon;

  @field kitName = contains(StringField);
  @field description = contains(StringField);
  @field category = contains(StringField); // e.g., "Analog", "Trap", "House"
  @field creator = contains(StringField);
  @field kit = contains(DrumKitField); // The actual sound parameters

  @field title = contains(StringField, {
    computeVia: function (this: DrumKitCard) {
      try {
        return this.kitName ?? 'Untitled Kit';
      } catch (e) {
        console.error('DrumKitCard: Error computing title', e);
        return 'Untitled Kit';
      }
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='drum-kit-card'>
        <div class='kit-header'>
          <h3 class='kit-title'>{{if
              @model.kitName
              @model.kitName
              'Untitled Kit'
            }}</h3>
          {{#if @model.category}}
            <span class='category-tag'>{{@model.category}}</span>
          {{/if}}
        </div>

        {{#if @model.description}}
          <p class='kit-description'>{{@model.description}}</p>
        {{/if}}

        {{#if @fields.kit}}
          <div class='kit-preview'>
            <@fields.kit @format='embedded' />
          </div>
        {{/if}}

        {{#if @model.creator}}
          <div class='kit-footer'>
            <span class='creator'>by {{@model.creator}}</span>
          </div>
        {{/if}}
      </div>

      <style scoped>
        .drum-kit-card {
          background: linear-gradient(135deg, #1e293b 0%, #374151 100%);
          border-radius: var(--radius-xl, var(--boxel-border-radius-xl));
          padding: 1rem;
          color: white;
          border: 1px solid #4b5563;
          transition: all 0.2s ease;
        }

        .drum-kit-card:hover {
          transform: translateY(-1px);
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
          border-color: #10b981;
        }

        .kit-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 0.75rem;
        }

        .kit-title {
          font-size: 1rem;
          font-weight: 700;
          margin: 0;
          background: linear-gradient(135deg, #10b981, #34d399);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .category-tag {
          background: #10b981;
          color: white;
          padding: 0.25rem 0.5rem;
          border-radius: var(--radius-xl, var(--boxel-border-radius-xl));
          font-size: 0.625rem;
          font-weight: 600;
          text-transform: uppercase;
        }

        .kit-description {
          font-size: 0.75rem;
          color: #cbd5e1;
          margin: 0 0 0.75rem 0;
          line-height: 1.4;
        }

        .kit-footer {
          padding-top: 0.5rem;
          border-top: 1px solid #4b5563;
        }

        .creator {
          font-size: 0.625rem;
          color: #9ca3af;
          font-style: italic;
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <div class='beat-pattern-card'>
        <div class='pattern-header'>
          <h3 class='pattern-title'>{{if
              @model.kitName
              @model.kitName
              'Untitled Kit'
            }}</h3>
          <div class='pattern-meta'>
            {{#if @model.category}}
              <span class='genre-tag'>{{@model.category}}</span>
            {{/if}}
          </div>
        </div>

        {{#if @model.description}}
          <p class='pattern-description'>{{@model.description}}</p>
        {{/if}}

        {{#if @fields.kit}}
          <div class='pattern-preview'>
            <@fields.kit @format='embedded' />
          </div>
        {{/if}}

        {{#if @model.creator}}
          <div class='pattern-footer'>
            <span class='creator'>by {{@model.creator}}</span>
          </div>
        {{/if}}
      </div>

      <style scoped>
        .beat-pattern-card {
          background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
          border-radius: var(--radius-xl, var(--boxel-border-radius-xl));
          padding: 1rem;
          color: white;
          border: 1px solid #374151;
          transition: all 0.2s ease;
        }

        .beat-pattern-card:hover {
          transform: translateY(-1px);
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
          border-color: #60a5fa;
        }

        .pattern-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 0.75rem;
        }

        .pattern-title {
          font-size: 1rem;
          font-weight: 700;
          margin: 0;
          background: linear-gradient(135deg, #60a5fa, #a78bfa);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .pattern-meta {
          display: flex;
          gap: 0.5rem;
          align-items: center;
        }

        .genre-tag {
          background: #374151;
          color: #e5e7eb;
          padding: 0.25rem 0.5rem;
          border-radius: var(--radius-xl, var(--boxel-border-radius-xl));
          font-size: 0.625rem;
          font-weight: 600;
          text-transform: uppercase;
        }

        .bpm-indicator {
          background: #10b981;
          color: white;
          padding: 0.25rem 0.5rem;
          border-radius: var(--radius, var(--boxel-border-radius));
          font-size: 0.625rem;
          font-weight: 700;
          font-family: 'JetBrains Mono', monospace;
        }

        .pattern-description {
          font-size: 0.75rem;
          color: #cbd5e1;
          margin: 0 0 0.75rem 0;
          line-height: 1.4;
        }

        .pattern-preview {
          margin-bottom: 0.75rem;
        }

        .pattern-footer {
          padding-top: 0.5rem;
          border-top: 1px solid #374151;
        }

        .creator {
          font-size: 0.625rem;
          color: #9ca3af;
          font-style: italic;
        }
      </style>
    </template>
  };
}

export class BeatPatternField extends FieldDef {
  static displayName = 'Beat Pattern';
  static icon = MusicIcon;

  @field name = contains(StringField);
  @field kick = contains(StringField); // JSON string of boolean array
  @field snare = contains(StringField);
  @field hihat = contains(StringField);
  @field openhat = contains(StringField);
  @field clap = contains(StringField);
  @field crash = contains(StringField);

  get patternData() {
    try {
      return {
        kick: JSON.parse(
          this.kick ||
            '[false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false]',
        ),
        snare: JSON.parse(
          this.snare ||
            '[false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false]',
        ),
        hihat: JSON.parse(
          this.hihat ||
            '[false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false]',
        ),
        openhat: JSON.parse(
          this.openhat ||
            '[false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false]',
        ),
        clap: JSON.parse(
          this.clap ||
            '[false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false]',
        ),
        crash: JSON.parse(
          this.crash ||
            '[false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false]',
        ),
      };
    } catch (e) {
      console.error('Error parsing pattern data:', e);
      return {
        kick: new Array(16).fill(false),
        snare: new Array(16).fill(false),
        hihat: new Array(16).fill(false),
        openhat: new Array(16).fill(false),
        clap: new Array(16).fill(false),
        crash: new Array(16).fill(false),
      };
    }
  }

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='beat-pattern-field'>
        <div class='pattern-name'>{{if
            @model.name
            @model.name
            'Unnamed Pattern'
          }}</div>
        <div class='pattern-preview'>
          <div class='pattern-bars'>
            {{#each
              (array 0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15)
              as |stepIndex|
            }}
              <div
                class='pattern-step
                  {{if (get @model.patternData.kick stepIndex) "has-kick" ""}}'
              ></div>
            {{/each}}
          </div>
        </div>
      </div>

      <style scoped>
        .beat-pattern-field {
          padding: 0.5rem;
          border: 1px solid #e5e7eb;
          border-radius: var(--radius, var(--boxel-border-radius));
          background: white;
        }

        .pattern-name {
          font-size: 0.75rem;
          font-weight: 600;
          color: #374151;
          margin-bottom: 0.375rem;
        }

        .pattern-bars {
          display: flex;
          gap: 1px;
        }

        .pattern-step {
          width: 12px;
          height: 8px;
          background: #f3f4f6;
          border-radius: var(--radius-xxs, var(--boxel-border-radius-xxs));
        }

        .pattern-step.has-kick {
          background: #f59e0b;
        }
      </style>
    </template>
  };
}

export class BeatPatternCard extends CardDef {
  static displayName = 'Beat Pattern';
  static icon = MusicIcon;

  @field patternName = contains(StringField);
  @field description = contains(StringField);
  @field bpm = contains(NumberField);
  @field genre = contains(StringField);
  @field creator = contains(StringField);
  @field pattern = contains(BeatPatternField); // The actual pattern data

  @field title = contains(StringField, {
    computeVia: function (this: BeatPatternCard) {
      try {
        return this.patternName ?? 'Untitled Beat';
      } catch (e) {
        console.error('BeatPatternCard: Error computing title', e);
        return 'Untitled Beat';
      }
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='beat-pattern-card'>
        <div class='pattern-header'>
          <h3 class='pattern-title'>{{if
              @model.patternName
              @model.patternName
              'Untitled Beat'
            }}</h3>
          <div class='pattern-meta'>
            {{#if @model.genre}}
              <span class='genre-tag'>{{@model.genre}}</span>
            {{/if}}
            {{#if @model.bpm}}
              <span class='preset-bpm'>{{@model.bpm}} BPM</span>
            {{/if}}
          </div>
        </div>

        {{#if @model.description}}
          <p class='pattern-description'>{{@model.description}}</p>
        {{/if}}

        {{#if @fields.pattern}}
          <div class='pattern-preview'>
            <@fields.pattern @format='embedded' />
          </div>
        {{/if}}

        {{#if @model.creator}}
          <div class='pattern-footer'>
            <span class='creator'>by {{@model.creator}}</span>
          </div>
        {{/if}}
      </div>

      <style scoped>
        .beat-pattern-card {
          background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
          border-radius: var(--radius-xl, var(--boxel-border-radius-xl));
          padding: 1rem;
          color: white;
          border: 1px solid #374151;
          transition: all 0.2s ease;
        }

        .beat-pattern-card:hover {
          transform: translateY(-1px);
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
          border-color: #60a5fa;
        }

        .pattern-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 0.75rem;
        }

        .pattern-title {
          font-size: 1rem;
          font-weight: 700;
          margin: 0;
          background: linear-gradient(135deg, #60a5fa, #a78bfa);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .pattern-meta {
          display: flex;
          gap: 0.5rem;
          align-items: center;
        }

        .genre-tag {
          background: #374151;
          color: #e5e7eb;
          padding: 0.25rem 0.5rem;
          border-radius: var(--radius-xl, var(--boxel-border-radius-xl));
          font-size: 0.625rem;
          font-weight: 600;
          text-transform: uppercase;
        }

        .bpm-indicator {
          background: #10b981;
          color: white;
          padding: 0.25rem 0.5rem;
          border-radius: var(--radius, var(--boxel-border-radius));
          font-size: 0.625rem;
          font-weight: 700;
          font-family: 'JetBrains Mono', monospace;
        }

        .pattern-description {
          font-size: 0.75rem;
          color: #cbd5e1;
          margin: 0 0 0.75rem 0;
          line-height: 1.4;
        }

        .pattern-preview {
          margin-bottom: 0.75rem;
        }

        .pattern-footer {
          padding-top: 0.5rem;
          border-top: 1px solid #374151;
        }

        .creator {
          font-size: 0.625rem;
          color: #9ca3af;
          font-style: italic;
        }
      </style>
    </template>
  };
}

class BeatMakerIsolated extends Component<typeof BeatMakerCard> {
  // ²¹ Beat maker embedded format - ⁷⁴ Now uses model values directly
  @tracked isPlaying = false;
  @tracked currentStep = 0;
  @tracked volumes = {
    kick: 85,
    snare: 75,
    hihat: 60,
    openhat: 50,
    clap: 70,
    crash: 40,
  };

  // ⁷⁵ Use model values directly instead of separate tracked properties
  get bpm() {
    return this.args.model?.bpm || 120;
  }

  get swing() {
    return this.args.model?.swing || 0;
  }

  get masterVolume() {
    return this.args.model?.masterVolume || 75;
  }

  // ⁹⁵ Get current kit name from loaded kit card or fallback to string
  get selectedKit() {
    return (
      this.args.model?.currentKit?.kitName ||
      this.args.model?.instrumentKit ||
      '808 Analog'
    );
  }

  getInstrumentVolume = (instrument: string): number => {
    return (this.volumes as any)[instrument] || 0;
  };

  // ¹⁰⁶ Get current kit sound parameters from loaded kit card - properly parse JSON strings
  get currentKitParams() {
    try {
      const kit = this.args.model?.currentKit?.kit;
      if (kit) {
        return {
          kick: JSON.parse(
            kit.kickParams || '{"type": "808", "frequency": 60, "decay": 0.3}',
          ),
          snare: JSON.parse(
            kit.snareParams ||
              '{"type": "808", "frequency": 200, "decay": 0.1}',
          ),
          hihat: JSON.parse(
            kit.hihatParams ||
              '{"type": "808", "frequency": 8000, "decay": 0.05}',
          ),
          openhat: JSON.parse(
            kit.openhatParams ||
              '{"type": "808", "frequency": 6000, "decay": 0.3}',
          ),
          clap: JSON.parse(
            kit.clapParams ||
              '{"type": "808", "frequency": 2000, "decay": 0.1}',
          ),
          crash: JSON.parse(
            kit.crashParams ||
              '{"type": "808", "frequency": 3000, "decay": 1.0}',
          ),
        };
      }
      // Fallback to default 808 parameters
      return {
        kick: { type: '808', frequency: 60, decay: 0.3 },
        snare: { type: '808', frequency: 200, decay: 0.1 },
        hihat: { type: '808', frequency: 8000, decay: 0.05 },
        openhat: { type: '808', frequency: 6000, decay: 0.3 },
        clap: { type: '808', frequency: 2000, decay: 0.1 },
        crash: { type: '808', frequency: 3000, decay: 1.0 },
      };
    } catch (e) {
      console.error('Error accessing kit parameters:', e);
      return {
        kick: { type: '808', frequency: 60, decay: 0.3 },
        snare: { type: '808', frequency: 200, decay: 0.1 },
        hihat: { type: '808', frequency: 8000, decay: 0.05 },
        openhat: { type: '808', frequency: 6000, decay: 0.3 },
        clap: { type: '808', frequency: 2000, decay: 0.1 },
        crash: { type: '808', frequency: 3000, decay: 1.0 },
      };
    }
  }

  // ⁹⁷ Get available drum kits from the model
  get availableKits() {
    try {
      if (
        this.args.model?.availableKits &&
        this.args.model.availableKits.length > 0
      ) {
        return this.args.model.availableKits;
      }
      // Return empty array if no kits available
      return [];
    } catch (e) {
      console.error('Error accessing available kits:', e);
      return [];
    }
  }

  // ⁹⁸ Get available patterns from the model
  get availablePatterns() {
    try {
      if (
        this.args.model?.availablePatterns &&
        this.args.model.availablePatterns.length > 0
      ) {
        return this.args.model.availablePatterns;
      }
      return [];
    } catch (e) {
      console.error('Error accessing available patterns:', e);
      return [];
    }
  }
  // ⁸⁵ Get patterns from current pattern card or use default
  get patterns() {
    try {
      if (this.args.model?.currentPattern?.pattern?.patternData) {
        return this.args.model.currentPattern.pattern.patternData;
      }

      // Default patterns if no pattern card is loaded
      return {
        kick: [
          true,
          false,
          false,
          false,
          true,
          false,
          false,
          false,
          true,
          false,
          false,
          false,
          true,
          false,
          false,
        ],
        snare: [
          false,
          false,
          false,
          false,
          true,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          true,
          false,
          false,
        ],
        hihat: [
          true,
          true,
          true,
          true,
          true,
          true,
          true,
          true,
          true,
          true,
          true,
          true,
          true,
          true,
          true,
        ],
        openhat: [
          false,
          false,
          false,
          true,
          false,
          false,
          false,
          true,
          false,
          false,
          false,
          true,
          false,
          false,
          false,
        ],
        clap: [
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
        ],
        crash: [
          true,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
        ],
      };
    } catch (e) {
      console.error('Error getting patterns:', e);
      return {
        kick: new Array(16).fill(false),
        snare: new Array(16).fill(false),
        hihat: new Array(16).fill(false),
        openhat: new Array(16).fill(false),
        clap: new Array(16).fill(false),
        crash: new Array(16).fill(false),
      };
    }
  }

  // Visual current step that's one behind the internal current step for proper highlighting
  get visualCurrentStep() {
    return this.currentStep === 0 ? 15 : this.currentStep - 1;
  }

  // Computed getter that creates a flattened step-state structure for easier template access
  get stepStates() {
    try {
      const patterns = this.patterns;
      const states: { [key: string]: boolean } = {};

      Object.keys(patterns).forEach((instrument) => {
        const instrumentPattern = patterns[instrument as keyof typeof patterns];
        if (instrumentPattern) {
          for (let step = 0; step < 16; step++) {
            states[`${instrument}-${step}`] = instrumentPattern[step] || false;
          }
        }
      });

      return states;
    } catch (e) {
      console.error('Error creating step states:', e);
      return {};
    }
  }

  // ⁸⁶ Update patterns in the current pattern card
  updatePatterns(newPatterns: any) {
    try {
      if (this.args.model?.currentPattern?.pattern) {
        // Update the pattern field data
        this.args.model.currentPattern.pattern.kick = JSON.stringify(
          newPatterns.kick,
        );
        this.args.model.currentPattern.pattern.snare = JSON.stringify(
          newPatterns.snare,
        );
        this.args.model.currentPattern.pattern.hihat = JSON.stringify(
          newPatterns.hihat,
        );
        this.args.model.currentPattern.pattern.openhat = JSON.stringify(
          newPatterns.openhat,
        );
        this.args.model.currentPattern.pattern.clap = JSON.stringify(
          newPatterns.clap,
        );
        this.args.model.currentPattern.pattern.crash = JSON.stringify(
          newPatterns.crash,
        );
      }
    } catch (e) {
      console.error('Error updating patterns:', e);
    }
  }

  // ⁴⁸ Audio context and sound generation
  audioContext: AudioContext | null = null;
  sequenceTimer: number | null = null;
  nextStepTime = 0;
  lookahead = 25.0; // How frequently to call scheduling function (in milliseconds)
  scheduleAheadTime = 0.1; // How far ahead to schedule audio (sec)

  constructor(owner: any, args: any) {
    super(owner, args);
    // Initialize audio context on first user interaction
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

  // Ensure audio stops when this instance is torn down (e.g., switching cards)
  willDestroy(): void {
    this.stop();
    if (this.audioContext) {
      // Close without awaiting to avoid blocking teardown
      this.audioContext.close().catch(() => undefined);
    }
    this.audioContext = null;
  }

  // ⁴⁹ Dynamic sound synthesis using kit parameters
  playKick(time: number, volume: number) {
    if (!this.audioContext) return;

    const kickParams = this.currentKitParams.kick;
    this.playDynamicKick(time, volume, kickParams);
  }

  // ⁹⁹ Universal kick synthesis using dynamic parameters
  playDynamicKick(time: number, volume: number, params: any) {
    const osc = this.audioContext!.createOscillator();
    const gain = this.audioContext!.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(params.frequency || 60, time);
    osc.frequency.exponentialRampToValueAtTime(
      (params.frequency || 60) * 0.5,
      time + 0.05,
    );
    osc.frequency.exponentialRampToValueAtTime(
      0.01,
      time + (params.decay || 0.3),
    );

    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(
      volume * (params.amplitude || 1.0),
      time + 0.01,
    );
    gain.gain.exponentialRampToValueAtTime(0.01, time + (params.decay || 0.3));

    osc.connect(gain);
    gain.connect(this.audioContext!.destination);

    osc.start(time);
    osc.stop(time + (params.decay || 0.3));
  }

  playSnare(time: number, volume: number) {
    if (!this.audioContext) return;

    const snareParams = this.currentKitParams.snare;
    this.playDynamicSnare(time, volume, snareParams);
  }

  playHihat(time: number, volume: number) {
    if (!this.audioContext) return;

    const hihatParams = this.currentKitParams.hihat;
    this.playDynamicHihat(time, volume, hihatParams);
  }

  playOpenhat(time: number, volume: number) {
    if (!this.audioContext) return;

    const openhatParams = this.currentKitParams.openhat;
    this.playDynamicHihat(time, volume, openhatParams); // ¹⁰⁷ Use dynamic parameters for open hat too
  }

  playClap(time: number, volume: number) {
    if (!this.audioContext) return;

    const clapParams = this.currentKitParams.clap;
    this.playDynamicSnare(time, volume, clapParams); // ¹⁰⁸ Use dynamic parameters for clap
  }

  playCrash(time: number, volume: number) {
    if (!this.audioContext) return;

    const crashParams = this.currentKitParams.crash;
    this.playDynamicHihat(time, volume, crashParams); // ¹⁰⁹ Use dynamic parameters for crash
  }

  // ¹⁰⁰ Universal snare synthesis using dynamic parameters
  playDynamicSnare(time: number, volume: number, params: any) {
    const noise = this.audioContext!.createBufferSource();
    const gain = this.audioContext!.createGain();
    const filter = this.audioContext!.createBiquadFilter();

    // Create noise buffer
    const bufferSize = this.audioContext!.sampleRate * (params.decay || 0.1);
    const buffer = this.audioContext!.createBuffer(
      1,
      bufferSize,
      this.audioContext!.sampleRate,
    );
    const output = buffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i++) {
      output[i] =
        (Math.random() * 2 - 1) *
        Math.pow(1 - i / bufferSize, params.shape || 2);
    }
    noise.buffer = buffer;

    filter.type = 'highpass';
    filter.frequency.value = params.frequency || 200;
    filter.Q.value = params.resonance || 5;

    gain.gain.setValueAtTime(volume * (params.amplitude || 0.8), time);
    gain.gain.exponentialRampToValueAtTime(0.01, time + (params.decay || 0.1));

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.audioContext!.destination);

    noise.start(time);
    noise.stop(time + (params.decay || 0.1));
  }

  // ¹⁰¹ Universal hihat synthesis using dynamic parameters
  playDynamicHihat(time: number, volume: number, params: any) {
    const noise = this.audioContext!.createBufferSource();
    const gain = this.audioContext!.createGain();
    const filter = this.audioContext!.createBiquadFilter();

    const bufferSize = this.audioContext!.sampleRate * (params.decay || 0.05);
    const buffer = this.audioContext!.createBuffer(
      1,
      bufferSize,
      this.audioContext!.sampleRate,
    );
    const output = buffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i++) {
      output[i] =
        (Math.random() * 2 - 1) *
        Math.pow(1 - i / bufferSize, params.shape || 4);
    }
    noise.buffer = buffer;

    filter.type = 'highpass';
    filter.frequency.value = params.frequency || 8000;
    filter.Q.value = params.resonance || 2;

    gain.gain.setValueAtTime(volume * (params.amplitude || 0.6), time);
    gain.gain.exponentialRampToValueAtTime(0.01, time + (params.decay || 0.05));

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.audioContext!.destination);

    noise.start(time);
    noise.stop(time + (params.decay || 0.05));
  }

  // ¹¹⁰ All instruments now use universal dynamic sound generation

  // ⁵⁰ Sequencer timing and playback
  scheduler() {
    while (
      this.nextStepTime <
      this.audioContext!.currentTime + this.scheduleAheadTime
    ) {
      this.scheduleStep(this.currentStep, this.nextStepTime);
      this.nextStep();
    }
  }

  scheduleStep(stepNumber: number, time: number) {
    const masterVol = (this.masterVolume / 100) * 0.3; // Scale down for comfortable listening

    Object.keys(this.patterns).forEach((instrument) => {
      if (this.patterns[instrument as keyof typeof this.patterns][stepNumber]) {
        const volume =
          (this.volumes[instrument as keyof typeof this.volumes] / 100) *
          masterVol;

        switch (instrument) {
          case 'kick':
            this.playKick(time, volume);
            break;
          case 'snare':
            this.playSnare(time, volume);
            break;
          case 'hihat':
            this.playHihat(time, volume);
            break;
          case 'openhat':
            this.playOpenhat(time, volume);
            break;
          case 'clap':
            this.playClap(time, volume);
            break;
          case 'crash':
            this.playCrash(time, volume);
            break;
        }
      }
    });
  }

  nextStep() {
    const baseStepLength = 60.0 / this.bpm / 4; // 16th note length ⁸⁰ Uses model bpm value

    // Apply swing timing - affects every other beat (8th note pairs)
    const swingAmount = this.swing / 100; // Convert to 0-1 range
    let stepLength = baseStepLength;

    // Apply swing to off-beats (steps 1, 3, 5, 7, 9, 11, 13, 15)
    if (this.currentStep % 2 === 1) {
      // Delay off-beats based on swing amount (max 67% swing = triplet feel)
      stepLength = baseStepLength * (1 + swingAmount * 0.67);
    } else if (this.currentStep % 2 === 0 && this.currentStep > 0) {
      // Compensate on-beats to maintain overall timing
      stepLength = baseStepLength * (1 - swingAmount * 0.33);
    }

    this.nextStepTime += stepLength;
    this.currentStep = (this.currentStep + 1) % 16;
  }

  start() {
    if (!this.audioContext) {
      this.initializeAudio();
    }

    if (this.audioContext?.state === 'suspended') {
      this.audioContext.resume();
    }

    this.isPlaying = true;
    this.currentStep = 0;
    this.nextStepTime = this.audioContext!.currentTime;
    this.sequenceTimer = window.setInterval(
      () => this.scheduler(),
      this.lookahead,
    );
  }

  stop() {
    this.isPlaying = false;
    this.currentStep = 0;
    if (this.sequenceTimer) {
      clearInterval(this.sequenceTimer);
      this.sequenceTimer = null;
    }
  }

  // ¹⁰² No more hardcoded arrays - all dynamic from card data

  @action
  togglePlay() {
    if (this.isPlaying) {
      this.stop();
    } else {
      this.start();
    }
  }

  @action
  toggleStep(instrument: string, step: number) {
    const currentPatterns = this.patterns;
    const newPatterns = { ...currentPatterns };
    newPatterns[instrument as keyof typeof newPatterns] = [
      ...newPatterns[instrument as keyof typeof newPatterns],
    ];
    newPatterns[instrument as keyof typeof newPatterns][step] =
      !newPatterns[instrument as keyof typeof newPatterns][step];
    this.updatePatterns(newPatterns);
  }

  @action
  clearPattern(instrument: string) {
    const currentPatterns = this.patterns;
    const newPatterns = { ...currentPatterns };
    newPatterns[instrument as keyof typeof newPatterns] = new Array(16).fill(
      false,
    );
    this.updatePatterns(newPatterns);
  }

  @action
  fillPattern(instrument: string) {
    const currentPatterns = this.patterns;
    const newPatterns = { ...currentPatterns };
    newPatterns[instrument as keyof typeof newPatterns] = new Array(16).fill(
      true,
    );
    this.updatePatterns(newPatterns);
  }

  @action
  loadPreset(patternCard: any) {
    // ¹⁰³ Load pattern from a pattern card instead of hardcoded presets
    if (this.args.model && patternCard) {
      this.args.model.currentPattern = patternCard;
      // Also sync BPM if the pattern has one
      if (patternCard.bpm && this.args.model.bpm !== patternCard.bpm) {
        this.args.model.bpm = patternCard.bpm;
      }
    }
  }

  @action
  randomizePattern(instrument: string) {
    const currentPatterns = this.patterns;
    const newPatterns = { ...currentPatterns };
    newPatterns[instrument as keyof typeof newPatterns] = new Array(16)
      .fill(false)
      .map(() => Math.random() > 0.7);
    this.updatePatterns(newPatterns);
  }

  // ⁸⁷ Action to save current patterns as a new pattern card
  @action
  saveCurrentPattern() {
    // This would create a new BeatPatternCard instance with current patterns
    // Implementation would depend on card creation workflow
    console.log('Save current pattern functionality would be implemented here');
  }

  // ⁸⁸ Action to load a different pattern card
  @action
  loadPatternCard(patternCard: any) {
    if (this.args.model) {
      this.args.model.currentPattern = patternCard;
      // Also sync BPM if the pattern has one
      if (patternCard.bpm && this.args.model.bpm !== patternCard.bpm) {
        this.args.model.bpm = patternCard.bpm;
      }
    }
  }

  @action
  updateBpm(event: Event) {
    const target = event.target as HTMLInputElement;
    const value = parseInt(target.value);
    // ⁷⁶ Update the model's BPM value
    if (this.args.model) {
      this.args.model.bpm = value;
    }
  }

  @action
  updateSwing(event: Event) {
    const target = event.target as HTMLInputElement;
    const value = parseInt(target.value);
    // ⁷⁷ Update the model's swing value
    if (this.args.model) {
      this.args.model.swing = value;
    }
  }

  @action
  updateMasterVolume(event: Event) {
    const target = event.target as HTMLInputElement;
    const value = parseInt(target.value);
    // ⁷⁸ Update the model's master volume value
    if (this.args.model) {
      this.args.model.masterVolume = value;
    }
  }

  @action
  updateVolume(instrument: string, event: Event) {
    const target = event.target as HTMLInputElement;
    this.volumes = { ...this.volumes, [instrument]: parseInt(target.value) };
  }

  @action
  handleKitSelection(event: Event) {
    // ¹⁰⁵ Handle kit selection from dropdown
    const target = event.target as HTMLSelectElement;
    const selectedKitId = target.value;

    // Find the kit card by ID
    const selectedKit = this.availableKits.find(
      (kit) => kit.id === selectedKitId,
    );

    if (this.args.model && selectedKit) {
      this.args.model.currentKit = selectedKit;
      this.args.model.instrumentKit = selectedKit.kitName; // Keep for backward compatibility
      console.log('Kit switched to:', selectedKit.kitName);
    }
  }

  @action
  selectKit(kitCard: any) {
    // ¹⁰⁴ Load kit from a kit card instead of hardcoded string - kept for pattern loading
    if (this.args.model && kitCard) {
      this.args.model.currentKit = kitCard;
      this.args.model.instrumentKit = kitCard.kitName; // Keep for backward compatibility
    }
  }

  <template>
    <div class='beat-maker-card'>
      <div class='beat-maker-header'>
        <div class='header-left'>
          <h3>Beat Maker Studio</h3>
          <div class='kit-selector'>
            {{#if (gt this.availableKits.length 0)}}
              <label for='kit-selector' class='sr-only'>Select drum kit</label>
              <select
                id='kit-selector'
                class='kit-dropdown'
                {{on 'change' this.handleKitSelection}}
              >
                {{#each this.availableKits as |kitCard|}}
                  <option
                    value={{kitCard.id}}
                    selected={{eq kitCard.kitName this.selectedKit}}
                  >{{kitCard.kitName}}</option>
                {{/each}}
              </select>
            {{else}}
              <span class='kit-fallback'>{{this.selectedKit}}</span>
            {{/if}}
          </div>
        </div>

        <div class='header-controls'>
          <div class='control-group'>
            <label class='control-label' for='bpm-slider'>BPM</label>
            <input
              id='bpm-slider'
              type='range'
              min='60'
              max='200'
              value={{this.bpm}}
              class='slider bpm-slider'
              {{on 'input' this.updateBpm}}
            />
            <span class='control-value'>{{this.bpm}}</span>
          </div>

          <div class='control-group'>
            <label class='control-label' for='swing-slider'>Swing</label>
            <input
              id='swing-slider'
              type='range'
              min='0'
              max='100'
              value={{this.swing}}
              class='slider swing-slider'
              {{on 'input' this.updateSwing}}
            />
            <span class='control-value'>{{this.swing}}%</span>
          </div>

          <div class='control-group'>
            <label class='control-label' for='master-volume'>Master</label>
            <input
              id='master-volume'
              type='range'
              min='0'
              max='100'
              value={{this.masterVolume}}
              class='slider volume-slider'
              {{on 'input' this.updateMasterVolume}}
            />
            <span class='control-value'>{{this.masterVolume}}</span>
          </div>

          <Button
            class='play-button {{if this.isPlaying "playing" ""}}'
            {{on 'click' this.togglePlay}}
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
        </div>
      </div>

      {{#if (gt this.availablePatterns.length 0)}}
        <div class='presets-section'>
          <div class='presets-header'>
            <label class='presets-label'>Pattern Library</label>
            <div class='patterns-count'>{{this.availablePatterns.length}}
              patterns</div>
          </div>
          <div class='preset-buttons'>
            {{#each this.availablePatterns as |patternCard|}}
              <Button
                class='preset-button
                  {{if
                    (eq patternCard.id @model.currentPattern.id)
                    "active-pattern"
                    ""
                  }}'
                {{on 'click' (fn this.loadPreset patternCard)}}
              >
                <div class='preset-content'>
                  <span class='preset-name'>{{patternCard.patternName}}</span>
                  <div class='preset-meta'>
                    {{#if patternCard.genre}}
                      <span class='preset-genre'>{{patternCard.genre}}</span>
                    {{/if}}
                    {{#if patternCard.bpm}}
                      <span class='preset-bpm'>{{patternCard.bpm}} BPM</span>
                    {{/if}}
                  </div>
                </div>
              </Button>
            {{/each}}
          </div>
        </div>
      {{/if}}

      <div class='beat-grid'>
        <div class='step-numbers'>
          <div class='instrument-controls'></div>
          {{#each (array 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16) as |stepNum|}}
            <div
              class='step-number
                {{if
                  (or
                    (eq stepNum 1) (eq stepNum 5) (eq stepNum 9) (eq stepNum 13)
                  )
                  "beat-marker"
                  ""
                }}'
            >{{stepNum}}</div>
          {{/each}}
        </div>

        {{#each
          (array 'kick' 'snare' 'hihat' 'openhat' 'clap' 'crash')
          as |instrument|
        }}
          <div class='instrument-row'>
            <div class='instrument-controls'>
              <div class='instrument-label'>{{instrument}}</div>
              <div class='instrument-volume'>
                <label class='sr-only' for='volume-slider'>Volume</label>
                <input
                  id='volume-slider'
                  type='range'
                  min='0'
                  max='100'
                  value='{{this.getInstrumentVolume instrument}}'
                  class='volume-slider-small'
                  {{on 'input' (fn this.updateVolume instrument)}}
                />
                <span class='volume-value'>{{this.getInstrumentVolume
                    instrument
                  }}</span>
              </div>
              <div class='instrument-actions'>
                <button
                  class='action-button clear-button'
                  title='Clear pattern'
                  {{on 'click' (fn this.clearPattern instrument)}}
                >
                  <svg
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <line x1='18' y1='6' x2='6' y2='18' />
                    <line x1='6' y1='6' x2='18' y2='18' />
                  </svg>
                </button>
                <button
                  class='action-button fill-button'
                  title='Fill pattern'
                  {{on 'click' (fn this.fillPattern instrument)}}
                >
                  <svg
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <rect x='3' y='3' width='18' height='18' rx='2' ry='2' />
                  </svg>
                </button>
                <button
                  class='action-button random-button'
                  title='Randomize pattern'
                  {{on 'click' (fn this.randomizePattern instrument)}}
                >
                  <svg
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <polyline points='16 3 21 3 21 8' />
                    <line x1='4' y1='20' x2='21' y2='3' />
                    <polyline points='21 16 21 21 16 21' />
                    <line x1='15' y1='15' x2='21' y2='21' />
                    <line x1='4' y1='4' x2='9' y2='9' />
                  </svg>
                </button>
              </div>
            </div>

            <div class='step-buttons'>
              {{#each (array 0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15) as |step|}}
                <button
                  class='step-button
                    {{if
                      (get this.stepStates (concat instrument "-" step))
                      "active"
                      ""
                    }}
                    {{if (eq this.visualCurrentStep step) "current" ""}}
                    {{if
                      (or (eq step 0) (eq step 4) (eq step 8) (eq step 12))
                      "beat-marker"
                      ""
                    }}'
                  {{on 'click' (fn this.toggleStep instrument step)}}
                ></button>
              {{/each}}
            </div>
          </div>
        {{/each}}
      </div>

      <div class='beat-maker-footer'>
        <div class='footer-info'>
          <span class='kit-info'>{{this.selectedKit}}</span>
          <span class='pattern-info'>16-Step Sequencer</span>
          {{#if this.isPlaying}}
            <span class='status-playing'>
              <div class='pulse-dot'></div>
              Playing
            </span>
          {{else}}
            <span class='status-stopped'>Ready</span>
          {{/if}}
        </div>
      </div>
    </div>

    <style scoped>
      /* ²² Enhanced Beat maker styles with Claymorphic theme */
      .beat-maker-card {
        background: linear-gradient(145deg, #0a0e1a, #1a1f2e);
        border-radius: var(--radius-xl, var(--boxel-border-radius-xl));
        padding: 1.5rem;
        color: var(--foreground, #ffffff);
        font-family: var(--font-mono);
        min-height: 500px;

        box-shadow:
          inset 0 0 30px rgba(0, 0, 0, 0.5),
          0 10px 40px rgba(0, 0, 0, 0.7),
          0 2px 8px rgba(0, 0, 0, 0.9);
        border: 1px solid #1a1f2e;
      }

      /* Enhanced Header */
      .beat-maker-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: 1.5rem;
        gap: 1rem;
      }

      .header-left {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .beat-maker-header h3 {
        margin: 0;
        font-size: 1.25rem;
        font-weight: 700;
        background: linear-gradient(
          135deg,
          var(--primary, #60a5fa),
          var(--accent, #a78bfa)
        );
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
      }

      .kit-selector .kit-dropdown {
        background: var(--card, #374151);
        border: 1px solid var(--border, #4b5563);
        color: var(--card-foreground, #ffffff);
        padding: var(--spacing, 0.375rem) calc(var(--spacing, 0.25rem) * 3);
        border-radius: var(--radius, var(--boxel-border-radius));
        font-size: 0.75rem;
        font-family: var(--font-mono, 'JetBrains Mono', 'Fira Code', monospace);
      }

      .header-controls {
        display: flex;
        align-items: center;
        gap: 1rem;
      }

      .control-group {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.25rem;
        min-width: 80px;
      }

      .control-label {
        font-size: 0.625rem;
        color: var(--muted-foreground, #9ca3af);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        font-weight: 600;
      }

      .control-value {
        font-size: 0.75rem;
        color: var(--foreground, #e5e7eb);
        font-weight: 600;
        min-width: 40px;
        text-align: center;
      }

      .slider {
        width: 60px;
        height: 4px;
        background: var(--input, #374151);
        border-radius: var(--radius-xs, var(--boxel-border-radius-xs));
        outline: none;
        -webkit-appearance: none;
      }

      .slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        width: 16px;
        height: 16px;
        background: var(--primary, #60a5fa);
        border-radius: 50%;
        cursor: pointer;
        box-shadow: var(--shadow-xs, 0 1px 2px rgba(15, 23, 42, 0.3));
      }

      .slider::-moz-range-thumb {
        width: 16px;
        height: 16px;
        background: var(--primary, #60a5fa);
        border-radius: 50%;
        cursor: pointer;
        border: none;
        box-shadow: var(--shadow-xs, 0 1px 2px rgba(15, 23, 42, 0.3));
      }

      .play-button {
        width: 48px;
        height: 48px;
        border-radius: 50%;
        background: var(--primary, #10b981);
        border: none;
        color: var(--primary-foreground, #ffffff);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.2s ease;
        box-shadow: var(--shadow-md, 0 4px 12px rgba(16, 185, 129, 0.3));
      }

      .play-button:hover {
        background: var(--primary, #059669);
        transform: scale(1.05);
        box-shadow: var(--shadow-lg, 0 6px 16px rgba(16, 185, 129, 0.4));
        filter: brightness(1.1);
      }

      .play-button.playing {
        background: var(--destructive, #ef4444);
        box-shadow: var(--shadow-md, 0 4px 12px rgba(239, 68, 68, 0.3));
      }

      .play-button.playing:hover {
        background: var(--destructive, #dc2626);
        box-shadow: var(--shadow-lg, 0 6px 16px rgba(239, 68, 68, 0.4));
        filter: brightness(1.1);
      }

      .play-button svg {
        width: 20px;
        height: 20px;
      }

      /* Compact Pattern Library */
      .presets-section {
        margin-bottom: 1rem;
        padding: calc(var(--spacing, 0.25rem) * 3);
        background: linear-gradient(145deg, #0d1117, #1c2128);
        border-radius: var(--radius, var(--boxel-border-radius));
        border: 1px solid #2a3441;
        backdrop-filter: blur(8px);
        box-shadow:
          inset 0 0 15px rgba(0, 0, 0, 0.4),
          0 2px 10px rgba(0, 0, 0, 0.3);
      }

      .presets-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 0.5rem;
      }

      .presets-label {
        font-size: 0.75rem;
        color: var(--foreground, #e5e7eb);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .patterns-count {
        font-size: 0.625rem;
        color: var(--accent-foreground, #f59e0b);
        font-weight: 600;
        font-family: var(--font-mono, 'JetBrains Mono', 'Fira Code', monospace);
        background: var(--accent, rgba(245, 158, 11, 0.1));
        padding: var(--spacing, 0.125rem) calc(var(--spacing, 0.25rem) * 1.5);
        border-radius: var(--radius-sm, var(--boxel-border-radius-sm));
        border: 1px solid var(--border, rgba(245, 158, 11, 0.2));
      }

      .preset-buttons {
        display: flex;
        gap: 0.5rem;
        overflow-x: auto;
        padding-bottom: 0.25rem;
        max-height: 60px;
      }

      /* Horizontal scroll for pattern list */
      .preset-buttons::-webkit-scrollbar {
        height: 3px;
      }

      .preset-buttons::-webkit-scrollbar-track {
        background: rgba(55, 65, 81, 0.3);
        border-radius: var(--radius-xs, var(--boxel-border-radius-xs));
      }

      .preset-buttons::-webkit-scrollbar-thumb {
        background: rgba(245, 158, 11, 0.5);
        border-radius: var(--radius-xs, var(--boxel-border-radius-xs));
      }

      .preset-buttons::-webkit-scrollbar-thumb:hover {
        background: rgba(245, 158, 11, 0.7);
      }

      .preset-button {
        flex: 0 0 auto;
        min-width: 120px;
        padding: calc(var(--spacing, 0.25rem) * 2)
          calc(var(--spacing, 0.25rem) * 3);
        background: linear-gradient(145deg, #1e2530, #2a3441);
        border: 1px solid #3a4451;
        color: var(--secondary-foreground, #ffffff);
        border-radius: var(--radius, var(--boxel-border-radius));
        cursor: pointer;
        transition: all 0.2s ease;
        position: relative;
        white-space: nowrap;
        box-shadow:
          inset 0 0 8px rgba(0, 0, 0, 0.3),
          0 2px 6px rgba(0, 0, 0, 0.4);
      }

      .preset-button:hover {
        background: var(
          --secondary,
          linear-gradient(135deg, #4b5563 0%, #374151 100%)
        );
        border-color: var(--ring, #f59e0b);
        transform: translateY(-1px);
        box-shadow: var(--shadow-md, 0 2px 8px rgba(245, 158, 11, 0.2));
        filter: brightness(1.05);
      }

      .preset-button.active-pattern {
        background: var(
          --primary,
          linear-gradient(135deg, #f59e0b 0%, #f97316 100%)
        );
        border-color: var(--primary, #f59e0b);
        color: var(--primary-foreground, #ffffff);
        box-shadow: var(--shadow-lg, 0 2px 8px rgba(245, 158, 11, 0.3));
      }

      .preset-button.active-pattern::before {
        content: '';
        position: absolute;
        top: 0.25rem;
        right: 0.25rem;
        width: 6px;
        height: 6px;
        background: rgba(255, 255, 255, 0.9);
        border-radius: 50%;
        animation: active-pulse 2s ease-in-out infinite;
      }

      @keyframes active-pulse {
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

      .preset-content {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        text-align: left;
      }

      .preset-name {
        font-size: 0.75rem;
        font-weight: 600;
        line-height: 1.2;
        color: inherit;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .preset-meta {
        display: flex;
        gap: 0.25rem;
        flex-wrap: wrap;
      }

      .preset-genre {
        font-size: 0.5rem;
        background: rgba(156, 163, 175, 0.2);
        color: #d1d5db;
        padding: 0.0625rem 0.25rem;
        border-radius: var(--radius-xs, var(--boxel-border-radius-xs));
        font-weight: 500;
        text-transform: uppercase;
        letter-spacing: 0.025em;
      }

      .preset-bpm {
        font-size: 0.5rem;
        background: rgba(34, 211, 238, 0.2);
        color: #22d3ee;
        padding: 0.0625rem 0.25rem;
        border-radius: var(--radius-xs, var(--boxel-border-radius-xs));
        font-weight: 600;
        font-family: 'JetBrains Mono', monospace;
      }

      .preset-button.active-pattern .preset-genre {
        background: rgba(255, 255, 255, 0.2);
        color: rgba(255, 255, 255, 0.9);
      }

      .preset-button.active-pattern .preset-bpm {
        background: rgba(255, 255, 255, 0.2);
        color: rgba(255, 255, 255, 0.9);
      }

      .kit-fallback {
        color: #9ca3af;
        font-size: 0.75rem;
        font-style: italic;
      }

      /* Enhanced Beat Grid */
      .beat-grid {
        background: linear-gradient(145deg, #0f1419, #1e2530);
        border-radius: var(--radius-xl, var(--boxel-border-radius-xl));
        padding: calc(var(--spacing, 0.25rem) * 4);
        margin-bottom: 1.5rem;
        border: 1px solid #2a3441;
        box-shadow:
          inset 0 0 20px rgba(0, 0, 0, 0.6),
          0 4px 20px rgba(0, 0, 0, 0.5);
      }

      .step-numbers {
        display: flex;
        align-items: center;
        margin-bottom: 0.75rem;
        gap: 0.25rem;
      }

      .instrument-controls {
        width: 180px;
        flex-shrink: 0;
      }

      .step-number {
        width: 28px;
        height: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 0.625rem;
        color: var(--muted-foreground, #64748b);
        font-weight: 600;
      }

      .step-number.beat-marker {
        color: var(--ring, #f59e0b);
        font-weight: 700;
      }

      .instrument-row {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        margin-bottom: 0.75rem;
      }

      .instrument-label {
        font-size: 0.75rem;
        font-weight: 700;
        color: var(--foreground, #e5e7eb);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        min-width: 50px;
      }

      .instrument-volume {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        margin-top: 0.25rem;
      }

      .volume-slider-small {
        width: 40px;
        height: 3px;
        background: var(--input, #374151);
        border-radius: var(--radius-xs, var(--boxel-border-radius-xs));
        outline: none;
        -webkit-appearance: none;
      }

      .volume-slider-small::-webkit-slider-thumb {
        -webkit-appearance: none;
        width: 12px;
        height: 12px;
        background: var(--chart-2, #34d399);
        border-radius: 50%;
        cursor: pointer;
        box-shadow: var(--shadow-xs, 0 1px 2px rgba(15, 23, 42, 0.25));
      }

      .volume-slider-small::-moz-range-thumb {
        width: 12px;
        height: 12px;
        background: var(--chart-2, #34d399);
        border-radius: 50%;
        cursor: pointer;
        border: none;
        box-shadow: var(--shadow-xs, 0 1px 2px rgba(15, 23, 42, 0.25));
      }

      .volume-value {
        font-size: 0.625rem;
        color: var(--muted-foreground, #9ca3af);
        min-width: 24px;
      }

      .instrument-actions {
        display: flex;
        gap: 0.25rem;
        margin-top: 0.25rem;
      }

      .action-button {
        width: 20px;
        height: 20px;
        background: transparent;
        border: 1px solid var(--border, #4b5563);
        color: var(--muted-foreground, #9ca3af);
        border-radius: var(--radius-sm, var(--boxel-border-radius-sm));
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s ease;
      }

      .action-button:hover {
        border-color: var(--ring, #60a5fa);
        color: var(--ring, #60a5fa);
        box-shadow: var(--shadow-xs, 0 1px 2px rgba(96, 165, 250, 0.2));
      }

      .action-button svg {
        width: 10px;
        height: 10px;
      }

      .step-buttons {
        display: flex;
        gap: 0.25rem;
        flex: 1;
      }

      .step-button {
        width: 28px;
        height: 24px;
        border: none;
        background: linear-gradient(145deg, #2a3441, #1e2530);
        border-radius: 50%;
        cursor: pointer;
        transition: all 0.1s ease;
        position: relative;
        box-shadow:
          inset 0 0 8px rgba(0, 0, 0, 0.4),
          0 2px 4px rgba(0, 0, 0, 0.6),
          0 1px 2px rgba(255, 255, 255, 0.1);
      }

      .step-button:hover {
        background: linear-gradient(145deg, #3a4451, #2e3540);
        transform: translateY(-1px);
        box-shadow:
          inset 0 0 12px rgba(0, 0, 0, 0.3),
          0 3px 6px rgba(0, 0, 0, 0.7),
          0 1px 3px rgba(255, 255, 255, 0.15);
      }

      /* Instrument-specific colors for active steps using theme variables */
      .beat-grid .instrument-row:nth-child(2) .step-button.active {
        background: radial-gradient(
          circle,
          var(--destructive, #ef4444),
          color-mix(in srgb, var(--destructive, #ef4444) 70%, black)
        );
        box-shadow:
          inset 0 0 15px rgba(0, 0, 0, 0.3),
          0 0 20px
            color-mix(in srgb, var(--destructive, #ef4444) 40%, transparent),
          0 2px 8px rgba(0, 0, 0, 0.8);
      }

      .beat-grid .instrument-row:nth-child(3) .step-button.active {
        background: radial-gradient(
          circle,
          var(--chart-1, #3b82f6),
          color-mix(in srgb, var(--chart-1, #3b82f6) 70%, black)
        );
        box-shadow:
          inset 0 0 15px rgba(0, 0, 0, 0.3),
          0 0 20px color-mix(in srgb, var(--chart-1, #3b82f6) 40%, transparent),
          0 2px 8px rgba(0, 0, 0, 0.8);
      }

      .beat-grid .instrument-row:nth-child(4) .step-button.active {
        background: radial-gradient(
          circle,
          var(--chart-2, #10b981),
          color-mix(in srgb, var(--chart-2, #10b981) 70%, black)
        );
        box-shadow:
          inset 0 0 15px rgba(0, 0, 0, 0.3),
          0 0 20px color-mix(in srgb, var(--chart-2, #10b981) 40%, transparent),
          0 2px 8px rgba(0, 0, 0, 0.8);
      }

      .beat-grid .instrument-row:nth-child(5) .step-button.active {
        background: radial-gradient(
          circle,
          var(--chart-3, #f59e0b),
          color-mix(in srgb, var(--chart-3, #f59e0b) 70%, black)
        );
        box-shadow:
          inset 0 0 15px rgba(0, 0, 0, 0.3),
          0 0 20px color-mix(in srgb, var(--chart-3, #f59e0b) 40%, transparent),
          0 2px 8px rgba(0, 0, 0, 0.8);
      }

      .beat-grid .instrument-row:nth-child(6) .step-button.active {
        background: radial-gradient(
          circle,
          var(--chart-4, #8b5cf6),
          color-mix(in srgb, var(--chart-4, #8b5cf6) 70%, black)
        );
        box-shadow:
          inset 0 0 15px rgba(0, 0, 0, 0.3),
          0 0 20px color-mix(in srgb, var(--chart-4, #8b5cf6) 40%, transparent),
          0 2px 8px rgba(0, 0, 0, 0.8);
      }

      .beat-grid .instrument-row:nth-child(7) .step-button.active {
        background: radial-gradient(
          circle,
          var(--chart-5, #ec4899),
          color-mix(in srgb, var(--chart-5, #ec4899) 70%, black)
        );
        box-shadow:
          inset 0 0 15px rgba(0, 0, 0, 0.3),
          0 0 20px color-mix(in srgb, var(--chart-5, #ec4899) 40%, transparent),
          0 2px 8px rgba(0, 0, 0, 0.8);
      }

      /* Enhanced current step with instrument colors */
      .instrument-row .step-button.active.current {
        transform: scale(1.15);
      }

      .instrument-row:nth-child(1) .step-button.active.current {
        box-shadow:
          inset 0px 0px 16px 1px rgb(255 255 255),
          0 0 16px rgba(239, 68, 68, 0.8);
        mix-blend-mode: screen;
      }

      .instrument-row:nth-child(2) .step-button.active.current {
        box-shadow:
          inset 0px 0px 16px 1px rgb(255 255 255),
          0 0 16px rgba(59, 130, 246, 0.8);
        mix-blend-mode: screen;
      }

      .instrument-row:nth-child(3) .step-button.active.current {
        box-shadow:
          inset 0px 0px 16px 1px rgb(255 255 255),
          0 0 16px rgba(16, 185, 129, 0.8);
        mix-blend-mode: screen;
      }

      .instrument-row:nth-child(4) .step-button.active.current {
        box-shadow:
          inset 0px 0px 16px 1px rgb(255 255 255),
          0 0 16px rgba(245, 158, 11, 0.8);
        mix-blend-mode: screen;
      }

      .instrument-row:nth-child(5) .step-button.active.current {
        box-shadow:
          inset 0px 0px 16px 1px rgb(255 255 255),
          0 0 16px rgba(139, 92, 246, 0.8);
        mix-blend-mode: screen;
      }

      .instrument-row:nth-child(6) .step-button.active.current {
        box-shadow:
          inset 0px 0px 16px 1px rgb(255 255 255),
          0 0 16px rgba(236, 72, 153, 0.8);
        mix-blend-mode: screen;
      }

      .step-button.current {
        transform: scale(1.1);
        box-shadow:
          inset 0 0 12px rgba(255, 255, 255, 0.2),
          0 0 25px var(--ring, #60a5fa),
          0 4px 12px rgba(0, 0, 0, 0.9);
      }

      .step-button.beat-marker {
        border-top: 2px solid var(--ring, #f59e0b);
      }

      .step-button.active.current {
        transform: scale(1.15);
        box-shadow:
          inset 0 0 20px rgba(255, 255, 255, 0.3),
          0 0 30px currentColor,
          0 4px 15px rgba(0, 0, 0, 0.9);
        animation: current-pulse 0.8s ease-in-out infinite alternate;
      }

      @keyframes current-pulse {
        0% {
          filter: brightness(1);
        }
        100% {
          filter: brightness(1.3);
        }
      }

      /* Enhanced Footer */
      .beat-maker-footer {
        display: flex;
        justify-content: center;
      }

      .footer-info {
        display: flex;
        align-items: center;
        gap: 1rem;
        font-size: 0.75rem;
      }

      .kit-info,
      .pattern-info {
        color: var(--muted-foreground, #9ca3af);
      }

      .status-playing {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        color: var(--chart-2, #10b981);
        font-weight: 600;
      }

      .status-stopped {
        color: var(--muted-foreground, #64748b);
      }

      .pulse-dot {
        width: 8px;
        height: 8px;
        background: var(--chart-2, #10b981);
        border-radius: 50%;
        animation: pulse 1.5s ease-in-out infinite;
      }

      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        border: 0;
      }

      @keyframes pulse {
        0%,
        100% {
          opacity: 1;
          transform: scale(1);
        }
        50% {
          opacity: 0.5;
          transform: scale(1.2);
        }
      }

      /* Responsive Design */
      @media (max-width: 768px) {
        .beat-maker-card {
          padding: 1rem;
        }

        .beat-maker-header {
          flex-direction: column;
          align-items: stretch;
          gap: 1rem;
        }

        .header-controls {
          justify-content: space-between;
        }

        .control-group {
          min-width: 60px;
        }

        .slider {
          width: 50px;
        }

        .instrument-controls {
          width: 140px;
        }

        .step-button {
          width: 24px;
          height: 20px;
        }

        /* Mobile Pattern Library */
        .presets-section {
          padding: 0.5rem;
          margin-bottom: 0.75rem;
        }

        .presets-header {
          flex-direction: row;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 0.375rem;
        }

        .presets-label {
          font-size: 0.625rem;
        }

        .patterns-count {
          font-size: 0.5rem;
          padding: 0.0625rem 0.25rem;
        }

        .preset-buttons {
          gap: 0.375rem;
          max-height: 50px;
        }

        .preset-button {
          min-width: 100px;
          padding: 0.375rem 0.5rem;
        }

        .preset-name {
          font-size: 0.625rem;
        }

        .preset-genre,
        .preset-bpm {
          font-size: 0.4375rem;
          padding: 0.0625rem 0.1875rem;
        }
      }

      @media (max-width: 480px) {
        .preset-button {
          min-width: 90px;
          padding: 0.25rem 0.375rem;
        }

        .preset-name {
          font-size: 0.5625rem;
        }

        .patterns-count {
          font-size: 0.4375rem;
          padding: 0.0625rem 0.1875rem;
        }
      }

      /* Large screen optimizations */
      @media (min-width: 1200px) {
        .preset-buttons {
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          max-height: 220px;
        }
      }
    </style>
  </template>
}

export class BeatMakerCard extends CardDef {
  static displayName = 'Beat Maker';
  static icon = MusicIcon;

  @field bpm = contains(NumberField);
  @field pattern = contains(StringField); // Keep for backward compatibility
  @field instrumentKit = contains(StringField);
  @field swing = contains(NumberField);
  @field masterVolume = contains(NumberField);
  @field currentPattern = linksTo(() => BeatPatternCard); // ⁸⁴ Current loaded pattern
  @field currentKit = linksTo(() => DrumKitCard); // ⁹² Current loaded drum kit
  @field availableKits = linksToMany(() => DrumKitCard); // ⁹³ Available drum kits library
  @field availablePatterns = linksToMany(() => BeatPatternCard); // ⁹⁴ Available patterns library

  @field title = contains(StringField, {
    computeVia: function (this: BeatMakerCard) {
      return 'Beat Maker';
    },
  });

  static isolated = BeatMakerIsolated;

  static fitted = class Fitted extends Component<typeof this> {
    <template>
      <div class='fitted-container'>
        <div class='badge-format'>
          <div class='badge-content'>
            <div class='badge-icon'>
              <div class='beat-grid-mini'>
                <div class='beat-dot active'></div>
                <div class='beat-dot'></div>
                <div class='beat-dot active'></div>
                <div class='beat-dot'></div>
              </div>
            </div>
            <div class='badge-info'>
              <div class='badge-title'>Beat Maker</div>
              <div class='badge-stats'>{{if @model.bpm @model.bpm 120}}
                BPM</div>
            </div>
          </div>
        </div>

        <div class='strip-format'>
          <div class='strip-content'>
            <div class='strip-visual'>
              <div class='beat-visualizer'>
                <div class='beat-bar active'></div>
                <div class='beat-bar'></div>
                <div class='beat-bar active'></div>
                <div class='beat-bar'></div>
                <div class='beat-bar active'></div>
              </div>
            </div>
            <div class='strip-info'>
              <div class='strip-title'>Beat Maker Studio</div>
              <div class='strip-description'>{{if @model.bpm @model.bpm 120}}
                BPM •
                {{if
                  @model.currentKit.kitName
                  @model.currentKit.kitName
                  (if @model.instrumentKit @model.instrumentKit '808 Analog')
                }}</div>
            </div>
          </div>
        </div>

        <div class='tile-format'>
          <div class='tile-header'>
            <div class='tile-visual'>
              <div class='sequencer-grid'>
                <div class='seq-row'>
                  <div class='seq-step active'></div>
                  <div class='seq-step'></div>
                  <div class='seq-step'></div>
                  <div class='seq-step active'></div>
                </div>
                <div class='seq-row'>
                  <div class='seq-step'></div>
                  <div class='seq-step active'></div>
                  <div class='seq-step'></div>
                  <div class='seq-step'></div>
                </div>
                <div class='seq-row'>
                  <div class='seq-step active'></div>
                  <div class='seq-step active'></div>
                  <div class='seq-step active'></div>
                  <div class='seq-step active'></div>
                </div>
              </div>
            </div>
          </div>
          <div class='tile-content'>
            <h3 class='tile-title'>Beat Maker</h3>
            <div class='tile-specs'>
              <div class='spec-row'>
                <span class='spec-label'>BPM:</span>
                <span class='spec-value'>{{if @model.bpm @model.bpm 120}}</span>
              </div>
              <div class='spec-row'>
                <span class='spec-label'>Kit:</span>
                <span class='spec-value'>{{if
                    @model.currentKit.kitName
                    @model.currentKit.kitName
                    (if @model.instrumentKit @model.instrumentKit '808')
                  }}</span>
              </div>
              <div class='spec-row'>
                <span class='spec-label'>Patterns:</span>
                <span
                  class='spec-value'
                >{{@model.availablePatterns.length}}</span>
              </div>
            </div>
            <div class='tile-features'>
              <div class='feature-tag'>16-Step</div>
              <div class='feature-tag'>Synth</div>
              <div class='feature-tag'>Swing</div>
            </div>
          </div>
        </div>

        <div class='card-format'>
          <div class='card-header'>
            <div class='card-info'>
              <h3 class='card-title'>Beat Maker Studio</h3>
              <p class='card-description'>Professional drum machine with dynamic
                synthesis and pattern sequencing</p>
            </div>
            <div class='card-visual'>
              <div class='drum-machine'>
                <div class='machine-display'>
                  <div class='display-line'>
                    <span class='param-label'>BPM</span>
                    <span class='param-value'>{{if
                        @model.bpm
                        @model.bpm
                        120
                      }}</span>
                  </div>
                  <div class='display-line'>
                    <span class='param-label'>KIT</span>
                    <span class='param-value'>{{if
                        @model.currentKit.kitName
                        @model.currentKit.kitName
                        (if @model.instrumentKit @model.instrumentKit '808')
                      }}</span>
                  </div>
                </div>
                <div class='machine-controls'>
                  <div class='control-knob'></div>
                  <div class='control-knob'></div>
                  <div class='control-knob'></div>
                </div>
              </div>
            </div>
          </div>
          <div class='card-grid'>
            <div class='grid-section'>
              <div class='section-title'>Patterns</div>
              <div class='pattern-count'>{{if
                  @model.availablePatterns.length
                  @model.availablePatterns.length
                  8
                }}
                Available</div>
            </div>
            <div class='grid-section'>
              <div class='section-title'>Drum Kits</div>
              <div class='pattern-count'>{{if
                  @model.availableKits.length
                  @model.availableKits.length
                  6
                }}
                Loaded</div>
            </div>
            <div class='grid-section'>
              <div class='section-title'>Sequencer</div>
              <div class='pattern-count'>16-Step Grid</div>
            </div>
          </div>
          <div class='card-features'>
            <div class='features-label'>Features:</div>
            <div class='feature-list'>
              <div class='feature-pill'>Dynamic Synthesis</div>
              <div class='feature-pill'>Pattern Library</div>
              <div class='feature-pill'>Real-time Control</div>
              <div class='feature-pill'>Kit Management</div>
            </div>
          </div>
        </div>
      </div>

      <style scoped>
        .fitted-container {
          container-type: size;
          width: 100%;
          height: 100%;
          font-family: 'JetBrains Mono', 'Fira Code', monospace;
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
          border-radius: var(--radius-xl, var(--boxel-border-radius-xl));
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

        .beat-grid-mini {
          display: grid;
          grid-template-columns: repeat(2, 8px);
          grid-template-rows: repeat(2, 8px);
          gap: 2px;
        }

        .beat-dot {
          width: 8px;
          height: 8px;
          background: rgba(245, 158, 11, 0.3);
          border-radius: var(--radius-xs, var(--boxel-border-radius-xs));
          transition: all 0.3s ease;
        }

        .beat-dot.active {
          background: #f59e0b;
          box-shadow: 0 0 6px rgba(245, 158, 11, 0.6);
          animation: beat-pulse 1.5s ease-in-out infinite;
        }

        @keyframes beat-pulse {
          0%,
          100% {
            opacity: 1;
          }
          50% {
            opacity: 0.6;
          }
        }

        .badge-info {
          flex: 1;
          min-width: 0;
        }

        .badge-title {
          font-size: 0.75rem;
          font-weight: 700;
          color: #f59e0b;
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

        .beat-visualizer {
          display: flex;
          align-items: flex-end;
          gap: 2px;
          height: 24px;
          width: 32px;
        }

        .beat-bar {
          width: 4px;
          background: rgba(245, 158, 11, 0.3);
          border-radius: var(--radius-xs, var(--boxel-border-radius-xs));
          transition: all 0.3s ease;
        }

        .beat-bar:nth-child(1) {
          height: 60%;
        }
        .beat-bar:nth-child(2) {
          height: 30%;
        }
        .beat-bar:nth-child(3) {
          height: 80%;
        }
        .beat-bar:nth-child(4) {
          height: 40%;
        }
        .beat-bar:nth-child(5) {
          height: 70%;
        }

        .beat-bar.active {
          background: #f59e0b;
          animation: bar-pulse 1.2s ease-in-out infinite;
        }

        @keyframes bar-pulse {
          0%,
          100% {
            transform: scaleY(1);
            opacity: 1;
          }
          50% {
            transform: scaleY(1.4);
            opacity: 0.8;
          }
        }

        .strip-info {
          flex: 1;
          min-width: 0;
        }

        .strip-title {
          font-size: 0.875rem;
          font-weight: 700;
          color: #f59e0b;
          line-height: 1.2;
          margin-bottom: 0.25rem;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .strip-description {
          font-size: 0.75rem;
          color: rgba(255, 255, 255, 0.7);
          font-family: 'JetBrains Mono', monospace;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .strip-badge {
          display: flex;
          align-items: center;
          gap: 0.25rem;
          padding: 0.25rem 0.5rem;
          background: rgba(239, 68, 68, 0.2);
          border: 1px solid #ef4444;
          border-radius: var(--radius, var(--boxel-border-radius));
          font-size: 0.625rem;
          font-weight: 700;
          color: #ef4444;
          font-family: 'JetBrains Mono', monospace;
          flex-shrink: 0;
        }

        .rec-indicator {
          width: 6px;
          height: 6px;
          background: #ef4444;
          border-radius: 50%;
          animation: rec-pulse 1s ease-in-out infinite;
        }

        @keyframes rec-pulse {
          0%,
          100% {
            opacity: 1;
            transform: scale(1);
          }
          50% {
            opacity: 0.4;
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
          background: linear-gradient(135deg, #f59e0b 0%, #f97316 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 1rem;
          border-radius: var(--radius-lg, var(--boxel-border-radius-lg));
        }

        .sequencer-grid {
          display: flex;
          flex-direction: column;
          gap: 3px;
        }

        .seq-row {
          display: flex;
          gap: 3px;
        }

        .seq-step {
          width: 8px;
          height: 8px;
          background: rgba(255, 255, 255, 0.3);
          border-radius: var(--radius-xs, var(--boxel-border-radius-xs));
          transition: all 0.3s ease;
        }

        .seq-step.active {
          background: rgba(255, 255, 255, 0.9);
          box-shadow: 0 0 4px rgba(255, 255, 255, 0.8);
        }

        .tile-badge {
          position: absolute;
          top: 0.5rem;
          right: 0.5rem;
          display: flex;
          align-items: center;
          gap: 0.25rem;
          padding: 0.25rem 0.5rem;
          background: rgba(255, 255, 255, 0.2);
          backdrop-filter: blur(8px);
          border-radius: var(--radius, var(--boxel-border-radius));
          font-size: 0.625rem;
          font-weight: 700;
          color: white;
          font-family: 'JetBrains Mono', monospace;
        }

        .live-dot {
          width: 6px;
          height: 6px;
          background: #22d3ee;
          border-radius: 50%;
          animation: live-pulse 2s ease-in-out infinite;
        }

        @keyframes live-pulse {
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

        .tile-content {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }

        .tile-title {
          font-size: 1rem;
          font-weight: 700;
          color: #f59e0b;
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
          color: #f59e0b;
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
          background: rgba(245, 158, 11, 0.2);
          border: 1px solid #f59e0b;
          color: #f59e0b;
          font-size: 0.625rem;
          font-weight: 600;
          border-radius: var(--radius-sm, var(--boxel-border-radius-sm));
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
          background: linear-gradient(135deg, #f59e0b 0%, #f97316 100%);
          padding: 1rem;
          border-radius: var(--radius-lg, var(--boxel-border-radius-lg));
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

        .drum-machine {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          padding: 0.75rem;
          background: rgba(15, 23, 42, 0.7);
          backdrop-filter: blur(8px);
          border-radius: var(--radius-lg, var(--boxel-border-radius-lg));
          min-width: 120px;
        }

        .machine-display {
          background: #0f172a;
          padding: 0.5rem;
          border-radius: var(--radius-sm, var(--boxel-border-radius-sm));
          border: 1px solid rgba(245, 158, 11, 0.3);
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
          color: #f59e0b;
          font-weight: 700;
          font-family: 'JetBrains Mono', monospace;
        }

        .machine-controls {
          display: flex;
          justify-content: space-between;
          gap: 0.25rem;
        }

        .control-knob {
          width: 16px;
          height: 16px;
          background: #374151;
          border: 2px solid #f59e0b;
          border-radius: 50%;
          position: relative;
        }

        .control-knob::after {
          content: '';
          position: absolute;
          top: 2px;
          left: 50%;
          transform: translateX(-50%);
          width: 2px;
          height: 6px;
          background: #f59e0b;
          border-radius: var(--radius-xxs, var(--boxel-border-radius-xxs));
        }

        .card-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 1rem;
          margin-bottom: 1rem;
          background: rgba(248, 250, 252, 0.1);
          border-radius: var(--radius-lg, var(--boxel-border-radius-lg));
          padding: 1rem;
        }

        .grid-section {
          text-align: center;
        }

        .section-title {
          font-size: 0.75rem;
          color: rgba(255, 255, 255, 0.7);
          font-weight: 600;
          margin-bottom: 0.5rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .pattern-count {
          font-size: 1rem;
          color: #f59e0b;
          font-weight: 700;
          font-family: 'JetBrains Mono', monospace;
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
          background: linear-gradient(135deg, #f59e0b 0%, #f97316 100%);
          color: white;
          font-size: 0.75rem;
          font-weight: 600;
          border-radius: var(--radius, var(--boxel-border-radius));
          border: 1px solid rgba(255, 255, 255, 0.1);
        }
      </style>
    </template>
  };
}
