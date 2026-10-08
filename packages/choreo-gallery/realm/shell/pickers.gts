import { on } from '@ember/modifier';

import { setTempo, settings, type Tempo, toggleCode } from '../lib/tempo';
import { setThemeMode, theme, type ThemeMode } from '../lib/theme';
import { type PreferenceOption, PreferencePicker } from './preference-picker';

/** the beacon the How panel flies out of and back into */
export const TRANSITION_CONTROL = 'transition-control';

const TEMPOS: PreferenceOption<Tempo>[] = [
  { label: 'Instant', value: 'instant' },
  { label: 'Smooth', value: 'smooth' },
  { label: 'Slow-mo', value: 'slow' },
];

const THEMES: PreferenceOption<ThemeMode>[] = [
  { label: 'Auto', value: 'auto' },
  { label: 'Light', value: 'light' },
  { label: 'Dark', value: 'dark' },
];

export const TempoPicker = <template>
  <PreferencePicker
    @beacon={{TRANSITION_CONTROL}}
    @icon='↗'
    @label='Page transition speed'
    @options={{TEMPOS}}
    @value={{settings.tempo}}
    @onChoose={{setTempo}}
    data-how-control
  >
    <button
      type='button'
      class='header-picker-help'
      {{on 'click' toggleCode}}
    >{{if
        settings.showCode
        'Hide how this works'
        'Show how this works'
      }}</button>
  </PreferencePicker>
  <style scoped>
    .header-picker-help {
      margin-top: 12px;
      padding: 4px 0;
      background: none;
      border: 0;
      color: var(--ink);
      font-size: 12px;
      cursor: pointer;
    }
  </style>
</template>;

export const ThemePicker = <template>
  <PreferencePicker
    @beacon='appearance-control'
    @icon='◐'
    @label='Appearance'
    @options={{THEMES}}
    @value={{theme.mode}}
    @onChoose={{setThemeMode}}
  />
</template>;
