// Pretui — Kbd usage page.
import GlimmerComponent from '@glimmer/component';
import { FreestyleUsage } from '../freestyle';
import { Kbd } from './kbd';

// ── Kbd ──────────────────────────────────────────────────────────────────
const KBD_SAMPLES = [
  'Mod+K',
  'Mod+Shift+P',
  'Meta+Shift+Alt+Ctrl+D',
  'Mod+Backspace',
  'ArrowUp',
  'Enter',
  'Escape',
  'F2',
];

class KbdUsage extends GlimmerComponent {
  samples = KBD_SAMPLES;
  <template>
    <FreestyleUsage
      @name='Kbd'
      @description='The shortcut token. One spec renders both platforms: "Mod" is ⌘ on Apple and Ctrl elsewhere, modifiers are ordered ⌃⌥⇧⌘ the way Apple orders them regardless of how they were typed, and named keys pick up their glyphs where the platform expects them. A literal face ("⌘K", "F2") passes through untouched, so hand-written shortcuts keep rendering. The visible glyphs are mirrored into aria-label as the platform-neutral aria-keyshortcuts spelling, so a screen reader announces "Command K" rather than reading a symbol it has no name for.'
    >
      <:example>
        <table class='kbd-table'>
          <thead>
            <tr><th>spec</th><th>Apple</th><th>other</th><th>announced</th></tr>
          </thead>
          <tbody>
            {{#each this.samples key='@index' as |spec|}}
              <tr>
                <td><code>{{spec}}</code></td>
                <td><Kbd @value={{spec}} @platform='apple' /></td>
                <td><Kbd @value={{spec}} @platform='other' /></td>
                <td class='kbd-spoken'>{{spec}}</td>
              </tr>
            {{/each}}
          </tbody>
        </table>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='value'
          @description='A shortcut spec ("Mod+Shift+P") or a literal face ("⌘K"). Modifier aliases: mod, cmd/command/meta/super/win, ctrl/control, alt/opt/option, shift.'
          @value='Mod+K'
        />
        <Args.String
          @name='platform'
          @description='"apple" or "other". Omit it and the platform is detected once, defensively — the module is evaluated by the indexer too, where navigator is not a browser.'
          @defaultValue='(detected)'
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .kbd-table {
        border-collapse: collapse;
        font-size: var(--text-ui-md, 12.5px);
      }
      .kbd-table th {
        text-align: start;
        padding-block: 4px;
        padding-inline: 0 20px;
        font-size: var(--text-ui-xs, 11px);
        font-weight: 600;
        letter-spacing: var(--track-eyebrow, 0.06em);
        text-transform: uppercase;
        color: var(--muted-foreground);
        border-bottom: 1px solid var(--border);
      }
      .kbd-table td {
        padding-block: 6px;
        padding-inline: 0 20px;
        vertical-align: middle;
      }
      .kbd-table code {
        font-family: var(--font-mono);
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--muted-foreground);
      }
      .kbd-spoken {
        font-size: var(--text-ui-xs, 11px);
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

//
// The same `MenuNode` tree, one pattern over: an application menu bar rather
// than a menu button. The tree below is written exactly as a `Menu` tree —
// commands, shortcuts, an ellipsis item, a toggle, a radio group, a nested
// submenu, a section, a separator, a destructive item and a dimmed one — and
// nothing about it knows which surface will render it.

export const DEMOS_KBD: Record<string, unknown> = {
  Kbd: KbdUsage,
};
