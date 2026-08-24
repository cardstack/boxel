import { on } from '@ember/modifier';
import { theme, toggleTheme } from 'test-app/lib/theme';

function isLight() {
  return theme.mode === 'light';
}

export const ThemePicker = <template>
  <button
    type="button"
    class="theme-toggle"
    aria-label="Switch to {{if (isLight) 'dark' 'light'}} mode"
    title="Switch to {{if (isLight) 'dark' 'light'}} mode"
    {{on "click" toggleTheme}}
  >
    {{#if (isLight)}}
      <svg class="theme-toggle-icon" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="4.5" />
        <path
          d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.36 5.64l-2.12 2.12M7.76 16.24l-2.12 2.12M18.36 18.36l-2.12-2.12M7.76 7.76L5.64 5.64"
        />
      </svg>
    {{else}}
      <svg class="theme-toggle-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M20.4 14.7A8.5 8.5 0 1 1 9.3 3.6a6.8 6.8 0 0 0 11.1 11.1Z" />
      </svg>
    {{/if}}
  </button>
</template>;
