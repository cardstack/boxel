import {
  Spec,
  SpecHeader,
  SpecReadmeSection,
  SpecModuleSection,
} from 'https://cardstack.com/base/spec';
import {
  field,
  contains,
  Component,
  CardDef,
  BaseDef,
  getCardMeta,
} from 'https://cardstack.com/base/card-api';
import AudioField from '../fields/audio';
import CodeSnippet from '../components/code-snippet';
import ExamplesWithInteractive from './components/examples-with-interactive';
import { action } from '@ember/object';
import { task } from 'ember-concurrency';
import { use, resource } from 'ember-resources';
import { TrackedObject } from 'tracked-built-ins';
import { isPrimitive, loadCardDef } from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common';
import GenerateReadmeSpecCommand from '@cardstack/boxel-host/commands/generate-readme-spec';

function myLoader(): Loader {
  // @ts-ignore
  return (import.meta as any).loader;
}

const standardFieldCode = `@field standard = contains(AudioField);`;
const waveformPlayerFieldCode = `@field waveformPlayer = contains(AudioField, {
  configuration: {
    presentation: 'waveform-player',
  },
});`;
const playlistRowFieldCode = `@field playlistRow = contains(AudioField, {
  configuration: {
    presentation: 'playlist-row',
  },
});`;
const miniPlayerFieldCode = `@field miniPlayer = contains(AudioField, {
  configuration: {
    presentation: 'mini-player',
  },
});`;
const albumCoverFieldCode = `@field albumCover = contains(AudioField, {
  configuration: {
    presentation: 'album-cover',
  },
});`;
const withVolumeFieldCode = `@field withVolume = contains(AudioField, {
  configuration: {
    options: {
      showVolume: true,
    },
  },
});`;
const trimEditorFieldCode = `@field trimEditor = contains(AudioField, {
  configuration: {
    presentation: 'trim-editor',
  },
});`;
const advancedControlsFieldCode = `@field advancedControls = contains(AudioField, {
  configuration: {
    options: {
      showVolume: true,
      showSpeedControl: true,
      showLoopControl: true,
    },
  },
});`;

class AudioFieldSpecIsolated extends Component<typeof AudioFieldSpec> {
  get defaultIcon() {
    if (!this.args.model) {
      return;
    }
    return this.args.model.constructor?.icon;
  }

  @action
  generateReadme() {
    this.generateReadmeTask.perform();
  }

  generateReadmeTask = task(async () => {
    if (!this.args.model) {
      return;
    }

    let commandContext = this.args.context?.commandContext;
    if (!commandContext) {
      console.error('Command context not available');
      return;
    }

    try {
      const generateReadmeSpecCommand = new GenerateReadmeSpecCommand(
        commandContext,
      );
      await generateReadmeSpecCommand.execute({
        spec: this.args.model as Spec,
      });
    } catch (error) {
      console.error('Error generating README:', error);
    }
  });

  get icon() {
    return this.cardDef?.icon;
  }

  @use private loadCardDef = resource(() => {
    let cardDefObj = new TrackedObject<{ value: typeof BaseDef | undefined }>({
      value: undefined,
    });
    (async () => {
      try {
        if (this.args.model.ref && this.args.model.id) {
          let cardDef = await loadCardDef(this.args.model.ref, {
            loader: myLoader(),
            relativeTo: new URL(this.args.model.id),
          });
          cardDefObj.value = cardDef;
        }
      } catch (e) {
        cardDefObj.value = undefined;
      }
    })();
    return cardDefObj;
  });

  get cardDef() {
    return this.loadCardDef.value;
  }

  get isPrimitiveField() {
    return isPrimitive(this.cardDef);
  }

  private get realmInfo() {
    return getCardMeta(this.args.model as CardDef, 'realmInfo');
  }

  <template>
    <article class='container'>
      <SpecHeader @icon={{this.icon}} @defaultIcon={{this.defaultIcon}}>
        <:title><@fields.cardTitle /></:title>
        <:description><@fields.cardDescription /></:description>
      </SpecHeader>

      <SpecReadmeSection>
        <@fields.readMe />
      </SpecReadmeSection>

       <ExamplesWithInteractive>
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{standardFieldCode}} />
          <@fields.standard />
        </article>
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{waveformPlayerFieldCode}} />
          <@fields.waveformPlayer />
        </article>
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{playlistRowFieldCode}} />
          <@fields.playlistRow />
        </article>
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{miniPlayerFieldCode}} />
          <@fields.miniPlayer />
        </article>
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{albumCoverFieldCode}} />
          <@fields.albumCover />
        </article>
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{withVolumeFieldCode}} />
          <@fields.withVolume />
        </article>
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{trimEditorFieldCode}} />
          <@fields.trimEditor />
        </article>
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{advancedControlsFieldCode}} />
          <@fields.advancedControls />
        </article>
      </ExamplesWithInteractive>

      <SpecModuleSection
        @moduleHref={{@model.moduleHref}}
        @refName={{@model.ref.name}}
        @specType={{@model.specType}}
        @realmInfo={{this.realmInfo}}
      />
    </article>
    <style scoped>
      .container {
        --boxel-spec-background-color: #ebeaed;
        --boxel-spec-code-ref-background-color: #e2e2e2;
        --boxel-spec-code-ref-text-color: #646464;

        height: 100%;
        min-height: max-content;
        padding: var(--boxel-sp);
        background-color: var(--boxel-spec-background-color);
      }
      .fields-configuration-card {
        border: var(--boxel-border);
        border-radius: var(--boxel-border-radius);
        background-color: var(--boxel-100);
        padding: var(--boxel-sp-xs);
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }
    </style>
  </template>
}

class AudioFieldSpecEdit extends Component<typeof AudioFieldSpec> {
  get defaultIcon() {
    if (!this.args.model) {
      return;
    }
    return this.args.model.constructor?.icon;
  }

  @action
  generateReadme() {
    this.generateReadmeTask.perform();
  }

  generateReadmeTask = task(async () => {
    if (!this.args.model) {
      return;
    }

    let commandContext = this.args.context?.commandContext;
    if (!commandContext) {
      console.error('Command context not available');
      return;
    }

    try {
      const generateReadmeSpecCommand = new GenerateReadmeSpecCommand(
        commandContext,
      );
      await generateReadmeSpecCommand.execute({
        spec: this.args.model as Spec,
      });
    } catch (error) {
      console.error('Error generating README:', error);
    }
  });

  get icon() {
    return this.cardDef?.icon;
  }

  @use private loadCardDef = resource(() => {
    let cardDefObject = new TrackedObject<{
      value: typeof BaseDef | undefined;
    }>({
      value: undefined,
    });
    (async () => {
      try {
        if (this.args.model.ref && this.args.model.id) {
          let cardDef = await loadCardDef(this.args.model.ref, {
            loader: myLoader(),
            relativeTo: new URL(this.args.model.id),
          });
          cardDefObject.value = cardDef;
        }
      } catch (e) {
        cardDefObject.value = undefined;
      }
    })();
    return cardDefObject;
  });

  get cardDef() {
    return this.loadCardDef.value;
  }

  get isPrimitiveField() {
    return isPrimitive(this.cardDef);
  }

  private get realmInfo() {
    return getCardMeta(this.args.model as CardDef, 'realmInfo');
  }

  <template>
    <article class='container'>
      <SpecHeader
        @icon={{this.icon}}
        @defaultIcon={{this.defaultIcon}}
        @isEditMode={{true}}
      >
        <:title><@fields.cardTitle /></:title>
        <:description><@fields.cardDescription /></:description>
      </SpecHeader>

      <SpecReadmeSection
        @canEdit={{@canEdit}}
        @onGenerateReadme={{this.generateReadme}}
        @isGenerating={{this.generateReadmeTask.isRunning}}
      >
        <@fields.readMe />
      </SpecReadmeSection>

      <ExamplesWithInteractive>
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{standardFieldCode}} />
          <@fields.standard @format='edit' />
        </article>
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{waveformPlayerFieldCode}} />
          <@fields.waveformPlayer @format='edit' />
        </article>
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{playlistRowFieldCode}} />
          <@fields.playlistRow @format='edit' />
        </article>
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{miniPlayerFieldCode}} />
          <@fields.miniPlayer @format='edit' />
        </article>
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{albumCoverFieldCode}} />
          <@fields.albumCover @format='edit' />
        </article>
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{withVolumeFieldCode}} />
          <@fields.withVolume @format='edit' />
        </article>
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{trimEditorFieldCode}} />
          <@fields.trimEditor @format='edit' />
        </article>
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{advancedControlsFieldCode}} />
          <@fields.advancedControls @format='edit' />
        </article>
      </ExamplesWithInteractive>

      <SpecModuleSection
        @moduleHref={{@model.moduleHref}}
        @refName={{@model.ref.name}}
        @specType={{@model.specType}}
        @realmInfo={{this.realmInfo}}
      />
    </article>
    <style scoped>
      .container {
        --boxel-spec-background-color: #ebeaed;
        --boxel-spec-code-ref-background-color: #e2e2e2;
        --boxel-spec-code-ref-text-color: #646464;

        height: 100%;
        min-height: max-content;
        padding: var(--boxel-sp);
        background-color: var(--boxel-spec-background-color);
      }
      .fields-configuration-card {
        border: var(--boxel-border);
        border-radius: var(--boxel-border-radius);
        background-color: var(--boxel-100);
        padding: var(--boxel-sp-xs);
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }
    </style>
  </template>
}

export class AudioFieldSpec extends Spec {
  static displayName = 'Audio Field Spec';

  // Standard AudioField - default inline player
  @field standard = contains(AudioField);

  // Waveform player - SoundCloud-style waveform visualization
  @field waveformPlayer = contains(AudioField, {
    configuration: {
      presentation: 'waveform-player',
    },
  });

  // Playlist row - Spotify-style playlist row
  @field playlistRow = contains(AudioField, {
    configuration: {
      presentation: 'playlist-row',
    },
  });

  // Mini player - Podcast-style mini player
  @field miniPlayer = contains(AudioField, {
    configuration: {
      presentation: 'mini-player',
    },
  });

  // Album cover - Album cover presentation
  @field albumCover = contains(AudioField, {
    configuration: {
      presentation: 'album-cover',
    },
  });

  // With volume control
  @field withVolume = contains(AudioField, {
    configuration: {
      options: {
        showVolume: true,
      },
    },
  });

  // Trim editor - Audio trimming interface
  @field trimEditor = contains(AudioField, {
    configuration: {
      presentation: 'trim-editor',
    },
  });

  // Advanced controls - Volume, speed, and loop controls
  @field advancedControls = contains(AudioField, {
    configuration: {
      options: {
        showVolume: true,
        showSpeedControl: true,
        showLoopControl: true,
      },
    },
  });

  static isolated = AudioFieldSpecIsolated as unknown as typeof Spec.isolated;
  static edit = AudioFieldSpecEdit as unknown as typeof Spec.edit;
}
