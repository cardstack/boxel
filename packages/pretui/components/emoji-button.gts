// Pretui — EmojiButton: a button that opens an EmojiPicker and inserts the choice.
import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { Popover } from './popover';
import { EmojiPicker } from './emoji-picker';
import type { EmojiSelection } from './emoji-picker';

// ── EmojiButton ──────────────────────────────────────────────────────────

export interface EmojiButtonSignature {
  Args: {
    /** Called with the chosen emoji; the popover closes on selection. */
    onSelect?: (selection: EmojiSelection) => void;
    /** Accessible name for the trigger. Default "Insert emoji". */
    label?: string;
    /** Where the popover opens. Default 'bottom-start'. */
    placement?: 'top' | 'top-start' | 'top-end' | 'bottom' | 'bottom-start' | 'bottom-end';
    /** Active skin tone 0-5; forwarded to the picker. */
    skinTone?: number;
    onSkinTone?: (skinTone: number) => void;
    /** Recently-used emoji, most recent first; forwarded to the picker. */
    recent?: readonly string[];
    onRecent?: (recent: readonly string[]) => void;
    /** Glyph painted on the trigger. Default a smiling face. */
    glyph?: string;
  };
  Element: HTMLSpanElement;
}

/**
 * The affordance that opens a picker.
 *
 * Placement, dismissal and the backdrop come from `Popover`
 * rather than being reinvented here — which also means the panel inherits
 * `--pretui-z-overlay` and this component hard-codes no stacking number. The
 * picker's own skin-tone list is the only thing that stacks, and it uses
 * `--pretui-z-dropdown`.
 *
 * The trigger paints an emoji rather than an icon because icon-registry.gts
 * has no face glyph; adding one would mean editing a file this component does
 * not own. The glyph is `aria-hidden` and the button's name comes from
 * `aria-label`, so nothing depends on the emoji being read aloud.
 */
export class EmojiButton extends Component<EmojiButtonSignature> {
  get label(): string {
    return this.args.label ?? 'Insert emoji';
  }

  get glyph(): string {
    return this.args.glyph ?? '\u{1F642}';
  }

  get placement() {
    return this.args.placement ?? 'bottom-start';
  }

  pick = (close: () => void, selection: EmojiSelection) => {
    this.args.onSelect?.(selection);
    close();
  };

  <template>
    <span class='pretui-emojibutton' data-test-pretui-emoji-button ...attributes>
      <Popover @placement={{this.placement}} @label={{this.label}}>
        <:trigger as |open toggle|>
          <button
            type='button'
            class='epb-trigger'
            aria-label={{this.label}}
            aria-haspopup='dialog'
            aria-expanded={{if open 'true' 'false'}}
            data-open={{if open 'true'}}
            data-test-pretui-emoji-trigger
            {{on 'click' toggle}}
          >
            <span class='epb-glyph' aria-hidden='true'>{{this.glyph}}</span>
          </button>
        </:trigger>
        <:default as |close|>
          <EmojiPicker
            @onSelect={{fn this.pick close}}
            @skinTone={{@skinTone}}
            @onSkinTone={{@onSkinTone}}
            @recent={{@recent}}
            @onRecent={{@onRecent}}
            @autofocus={{true}}
            @label={{this.label}}
          />
        </:default>
      </Popover>
    </span>

    <style scoped>
      @layer PretComponent {
        .pretui-emojibutton {
          display: inline-flex;
          /* Popover's own width knobs — set here so the panel is sized by the
             picker rather than by the overlay's default. */
          --pretui-popover-width: auto;
          --pretui-popover-min-width: 0;
          --pretui-popover-max-width: none;
        }

        .epb-trigger {
          display: grid;
          place-items: center;
          inline-size: var(--control-h, 28px);
          block-size: var(--control-h, 28px);
          padding: 0;
          border: 0;
          border-radius: var(--radius);
          background: transparent;
          color: var(--muted-foreground);
          cursor: pointer;
          opacity: 0.75;
          transition: opacity 120ms ease, background-color 120ms ease;
        }

        .epb-trigger:hover,
        .epb-trigger[data-open='true'] {
          opacity: 1;
          background: var(--muted);
        }

        .epb-trigger:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 1px;
        }

        .epb-glyph {
          font-family: var(
            --pretui-emoji-font,
            'Twemoji Mozilla',
            'Apple Color Emoji',
            'Segoe UI Emoji',
            'Segoe UI Symbol',
            'Noto Color Emoji',
            'EmojiOne Color',
            'Android Emoji',
            sans-serif
          );
          font-size: 1rem;
          line-height: 1;
        }

        @media (prefers-reduced-motion: reduce) {
          .epb-trigger {
            transition: none;
          }
        }

        @media (any-pointer: coarse) {
          .epb-trigger {
            inline-size: 2.75rem;
            block-size: 2.75rem;
          }
        }
      }
    </style>
  </template>
}
