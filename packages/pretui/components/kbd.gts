// Pretui — Kbd: the shortcut token, one spec rendered per platform.
import Component from '@glimmer/component';
import { formatShortcut, ariaKeyShortcuts } from '../internal/menu';
import type { ShortcutPlatform } from '../internal/menu';

export interface KbdSignature {
  Args: {
    /** shortcut spec (`'Mod+K'`) or a literal face */
    value: string;
    /** force a platform instead of detecting it — the docs pages use this to
     * show both spellings side by side */
    platform?: ShortcutPlatform;
  };
  Element: HTMLElement;
}

/**
 * The shortcut token. One `kbd` spec renders the Apple glyph run and the
 * Ctrl/Alt/Shift spelling, so no caller ever hard-codes a platform.
 */
export class Kbd extends Component<KbdSignature> {
  get face(): string | undefined {
    return formatShortcut(this.args.value, this.args.platform);
  }
  get spoken(): string | undefined {
    return ariaKeyShortcuts(this.args.value, this.args.platform);
  }
  <template>
    <kbd
      class='pretui-kbd'
      aria-label={{this.spoken}}
      data-test-pretui-kbd
      ...attributes
    >{{this.face}}</kbd>
    <style scoped>
      .pretui-kbd {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 1.5em;
        padding-block: 1px;
        padding-inline: 5px;
        border-radius: var(--radius-chip, 4px);
        background: var(--pretui-kbd-background, var(--inset, var(--boxel-100)));
        box-shadow: var(
          --pretui-shadow-hairline,
          0 0 0 1px var(--border)
        );
        color: var(--pretui-kbd-foreground, var(--muted-foreground));
        font-family: var(--font-mono);
        font-size: var(--text-ui-xs, 11px);
        font-variant-numeric: tabular-nums;
        line-height: 1.5;
        white-space: nowrap;
      }
    </style>
  </template>
}
