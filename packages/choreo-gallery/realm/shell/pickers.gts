import { setThemeMode, theme, type ThemeMode } from '../lib/theme';
import { type PreferenceOption, PreferencePicker } from './preference-picker';

const THEMES: PreferenceOption<ThemeMode>[] = [
  { label: 'Auto', value: 'auto' },
  { label: 'Light', value: 'light' },
  { label: 'Dark', value: 'dark' },
];

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
