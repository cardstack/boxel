import { Spec } from 'https://cardstack.com/base/spec';
import { field, contains } from 'https://cardstack.com/base/card-api';
import AudioField from '../fields/audio';
import FieldSpecEditTemplate from './components/field-spec-edit-template';
import FieldSpecIsolatedTemplate from './components/field-spec-isolated-template';

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

  static isolated = FieldSpecIsolatedTemplate;
  static edit = FieldSpecEditTemplate;
}
