import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { setThemeMode, theme, type ThemeMode } from 'test-app/lib/theme';

function is(value: ThemeMode) {
  return theme.mode === value;
}
function label() {
  return { auto: 'Auto', light: 'Light', dark: 'Dark' }[theme.mode];
}
function choose(value: ThemeMode, event: Event) {
  setThemeMode(value);
  (event.currentTarget as HTMLElement)
    .closest('details')
    ?.removeAttribute('open');
}
function dismiss(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    const menu = event.currentTarget as HTMLDetailsElement;
    menu.removeAttribute('open');
    menu.querySelector('summary')?.focus();
  }
}
export const ThemePicker = <template>
  <details
    name="header-preferences"
    class="header-picker"
    {{on "keydown" dismiss}}
  >
    <summary
      class="header-picker-pill"
      aria-label="Appearance"
      title="Appearance"
    >
      <span aria-hidden="true" class="header-picker-icon">◐</span>
      <span>{{label}}</span><span
        aria-hidden="true"
        class="header-picker-chevron"
      >⌄</span>
    </summary>
    <div class="header-picker-menu">
      <span class="header-picker-label">Appearance</span>
      <div class="header-picker-segments" role="group" aria-label="Appearance">
        <button
          type="button"
          aria-pressed={{is "auto"}}
          {{on "click" (fn choose "auto")}}
        >Auto</button>
        <button
          type="button"
          aria-pressed={{is "light"}}
          {{on "click" (fn choose "light")}}
        >Light</button>
        <button
          type="button"
          aria-pressed={{is "dark"}}
          {{on "click" (fn choose "dark")}}
        >Dark</button>
      </div>
    </div>
  </details>
</template>;
