import {
  Spec,
  SpecHeader,
  SpecReadmeSection,
  ExamplesWithInteractive,
  SpecModuleSection,
} from 'https://cardstack.com/base/spec';
import {
  field,
  contains,
  Component,
} from 'https://cardstack.com/base/card-api';
import AudioField from '../fields/audio';
import CodeSnippet from '../components/code-snippet';

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
  <template>
    <article class='container'>
      <SpecHeader @model={{@model}}>
        <:title><@fields.cardTitle /></:title>
        <:description><@fields.cardDescription /></:description>
      </SpecHeader>

      <SpecReadmeSection @model={{@model}} @context={{@context}}>
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

      <SpecModuleSection @model={{@model}} />
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
  <template>
    <article class='container'>
      <SpecHeader @model={{@model}} @isEditMode={{true}}>
        <:title><@fields.cardTitle /></:title>
        <:description><@fields.cardDescription /></:description>
      </SpecHeader>

      <SpecReadmeSection
        @model={{@model}}
        @context={{@context}}
        @isEditMode={{@canEdit}}
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

      <SpecModuleSection @model={{@model}} />
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
