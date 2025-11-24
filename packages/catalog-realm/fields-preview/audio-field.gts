import {
  CardDef,
  field,
  contains,
  type BaseDefConstructor,
  type Field,
} from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';
import { FieldContainer } from '@cardstack/boxel-ui/components';
import { getField } from '@cardstack/runtime-common';
import MusicIcon from '@cardstack/boxel-icons/music';

import { AudioField } from '../fields/audio';

export class AudioFieldPreview extends CardDef {
  @field audioField = contains(AudioField);
  @field waveformAudio = contains(AudioField, {
    configuration: {
      presentation: {
        style: 'waveform-player',
      },
    },
  });
  @field playlistAudio = contains(AudioField, {
    configuration: {
      presentation: {
        style: 'playlist-row',
      },
    },
  });
  @field volumeAudio = contains(AudioField, {
    configuration: {
      presentation: {
        showVolume: true,
      },
    },
  });
  @field trimEditorAudio = contains(AudioField, {
    configuration: {
      presentation: {
        style: 'trim-editor',
      },
    },
  });
  @field advancedAudio = contains(AudioField, {
    configuration: {
      presentation: {
        showVolume: true,
        showSpeedControl: true,
        showLoopControl: true,
      },
    },
  });
  @field miniPlayerAudio = contains(AudioField, {
    configuration: {
      presentation: {
        style: 'mini-player',
      },
    },
  });
  @field albumCoverAudio = contains(AudioField, {
    configuration: {
      presentation: {
        style: 'album-cover',
      },
    },
  });
  
  static displayName = 'Audio Field Preview';
  static icon = MusicIcon;

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <section class='fields'>
        <FieldContainer
          @label='AudioField'
          @icon={{this.getFieldIcon 'audioField'}}
          @vertical={{true}}
        >
          <FieldContainer @label='Edit'>
            <@fields.audioField @format='edit' />
          </FieldContainer>
          <FieldContainer @label='Embedded (Inline Player)'>
            <@fields.audioField @format='embedded' />
          </FieldContainer>
          <FieldContainer @label='Fitted (Card View)'>
            <div class='fitted-container'>
              <@fields.audioField
                @format='fitted'
                style='width: 100%; height: 100%'
              />
            </div>
          </FieldContainer>
          <FieldContainer @label='Atom'>
            <@fields.audioField @format='atom' />
          </FieldContainer>
        </FieldContainer>

        <FieldContainer
          @label='Waveform Player'
          @icon={{this.getFieldIcon 'waveformAudio'}}
          @vertical={{true}}
        >
          <@fields.waveformAudio @format='embedded' />
        </FieldContainer>

        <FieldContainer
          @label='Playlist Row (Spotify Style)'
          @icon={{this.getFieldIcon 'playlistAudio'}}
          @vertical={{true}}
        >
          <@fields.playlistAudio @format='embedded' />
        </FieldContainer>

        <FieldContainer
          @label='With Volume Control'
          @icon={{this.getFieldIcon 'volumeAudio'}}
          @vertical={{true}}
        >
          <@fields.volumeAudio @format='embedded' />
        </FieldContainer>

        <FieldContainer
          @label='Trim/Clip Editor'
          @icon={{this.getFieldIcon 'trimEditorAudio'}}
          @vertical={{true}}
        >
          <@fields.trimEditorAudio @format='embedded' />
        </FieldContainer>

        <FieldContainer
          @label='Advanced Controls (Speed + Loop)'
          @icon={{this.getFieldIcon 'advancedAudio'}}
          @vertical={{true}}
        >
          <@fields.advancedAudio @format='embedded' />
        </FieldContainer>

        <FieldContainer
          @label='Mini Player (Podcast/Article Style)'
          @icon={{this.getFieldIcon 'miniPlayerAudio'}}
          @vertical={{true}}
        >
          <@fields.miniPlayerAudio @format='embedded' />
        </FieldContainer>

        <FieldContainer
          @label='Album/Cover Art Player'
          @icon={{this.getFieldIcon 'albumCoverAudio'}}
          @vertical={{true}}
        >
          <div class='album-container'>
            <@fields.albumCoverAudio @format='embedded' />
          </div>
        </FieldContainer>
      </section>
      <style scoped>
        .fields {
          display: grid;
          gap: var(--boxel-sp-xxl);
          padding: var(--boxel-sp-xl);
        }
        .fitted-container {
          width: 300px;
          height: 350px;
        }
        .album-container {
          max-width: 400px;
        }
      </style>
    </template>
    getFieldIcon = (key: string) => {
      const field: Field<BaseDefConstructor> | undefined = getField(
        this.args.model.constructor!,
        key,
      );
      let fieldInstance = field?.card;
      return fieldInstance?.icon;
    };
  };
}
