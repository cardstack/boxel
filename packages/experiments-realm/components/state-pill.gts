import GlimmerComponent from '@glimmer/component';
import { Pill } from '@cardstack/boxel-ui/components';

import { stateColor, type Hue } from '../utils/index';

interface Signature {
  Args: {
    label?: string | null;
    hue?: Hue;
    /** Solid fill instead of the 14% dilution — reserve it for one state. */
    emphatic?: boolean;
    /** Leading dot. Off in tight rows where the label alone must fit. */
    dot?: boolean;
    /**
     * Chrome, not signal.
     *
     * A status name, a type, a tier are labels the reader parses once; a
     * priority and an SLA state are things they scan for. Painting all of them
     * costs the second group its advantage — five coloured things in a row
     * means none of them is the one to look at. Chrome renders as plain muted
     * text with no fill.
     */
    chrome?: boolean;
  };
  Element: HTMLElement;
}

/**
 * A small state label whose colour is derived, never stored.
 *
 * Every hue goes through `stateColor`, so the fill and the text are always the
 * checked pair from the same hue and the card's own foreground — a linked theme
 * flips both together and no combination can drift out of contrast.
 *
 * The chrome is boxel-ui's `Pill`; only the colour derivation is this app's.
 * The previous version drew its own rounded span, which is the library's job —
 * the part worth owning here is which hue a status maps to, and that stays.
 */
export class StatePill extends GlimmerComponent<Signature> {
  get colors() {
    return stateColor(this.args.hue ?? 'slate');
  }

  get colorArgs() {
    let { bg, fg, ring } = this.colors;
    if (this.args.chrome) {
      return {
        background: 'transparent',
        font: 'var(--muted-foreground, var(--boxel-450))',
        border: 'transparent',
      };
    }
    if (this.args.emphatic) {
      return {
        background: ring,
        font: 'var(--background, var(--boxel-light))',
        border: ring,
      };
    }
    return { background: bg, font: fg, border: bg };
  }

  <template>
    {{#if @label}}
      <Pill
        class='state-pill {{if @chrome "state-chrome"}}'
        @pillBackgroundColor={{this.colorArgs.background}}
        @pillFontColor={{this.colorArgs.font}}
        @pillBorderColor={{this.colorArgs.border}}
        ...attributes
      >
        <:default>
          {{#if @dot}}<span class='state-dot'></span>{{/if}}
          <span class='state-label'>{{@label}}</span>
        </:default>
      </Pill>
    {{/if}}

    <style scoped>
      /* Re-skinned through Pill's own knobs plus a size override — the app
         needs a denser chip than the library's default because forty of them
         share one queue row. */
      .state-pill {
        --boxel-pill-gap: 0.25rem;
        --boxel-pill-padding: 0.1em 0.45em;
        --boxel-pill-border-radius: 3px;
        --boxel-pill-font: 600 var(--boxel-font-size-xs) / 1.45
          var(--font-sans, var(--boxel-font-family));
        --boxel-lsp-xs: 0;
        max-width: 100%;
        white-space: nowrap;
      }
      .state-chrome {
        --boxel-pill-padding: 0.1em 0;
        --boxel-pill-font: 500 var(--boxel-font-size-xs) / 1.45
          var(--font-sans, var(--boxel-font-family));
      }
      .state-dot {
        width: 5px;
        height: 5px;
        flex: none;
        border-radius: 50%;
        background: currentColor;
      }
      .state-label {
        overflow: hidden;
        text-overflow: ellipsis;
      }
    </style>
  </template>
}

export default StatePill;
