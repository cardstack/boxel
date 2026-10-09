// Pretui — CopyButton: an IconButton that copies text to the clipboard.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { registerDestructor } from '@ember/destroyable';
import type Owner from '@ember/owner';
import { on } from '@ember/modifier';
import CheckIcon from '@cardstack/boxel-icons/check';
import CopyIcon from '@cardstack/boxel-icons/copy';
import XIcon from '@cardstack/boxel-icons/x';
import { IconButton, ICON_SIZE } from './icon-button';
import { VisuallyHidden } from './visually-hidden';
import { firstDefined } from '../pretui-primitives';
import type { IconButtonSignature } from './icon-button';
import type { PretuiSizeArg } from '../pretui-primitives';

// Fresh small. boxel-ui's copy-button rides Tooltip (ember-velcro
// wormhole — wart list forbids); this one is an IconButton that copies
// @text to the clipboard and swaps its glyph while the result holds.
// The result holds for 2 s, the duration every clipboard component settles
// on, whatever the input: a timer is the one reset.

type CopyState = 'idle' | 'copied' | 'failed';

const STATUS_TEXT: Record<CopyState, string> = {
  idle: '',
  copied: 'Copied',
  failed: 'Copy failed',
};

export const RESET_MS = 2000;

export interface CopyButtonSignature {
  Args: {
    text?: string | null | undefined;
    /** alias — the clipboard payload is this control's value, and `@value`
     * is what Chakra/Ant/Mantine's Clipboard all call it */
    value?: string | null | undefined;
    /** alias of @text, boxel-ui's spelling */
    textToCopy?: string | null | undefined;
    /** accessible name — 'Copy to clipboard' by default */
    label?: string;
    /** alias of @label, boxel-ui's spelling */
    ariaLabel?: string;
    tone?: IconButtonSignature['Args']['tone'];
    appearance?: IconButtonSignature['Args']['appearance'];
    /** deprecated sugar over @tone + @appearance */
    variant?: IconButtonSignature['Args']['variant'];
    size?: PretuiSizeArg;
    disabled?: boolean;
  };
  Element: HTMLButtonElement;
}

export class CopyButton extends Component<CopyButtonSignature> {
  @tracked state: CopyState = 'idle';
  // Announced separately from the glyph: a repeat copy empties the region
  // while the glyph keeps showing the last result, so the result is announced
  // again without a visible flicker.
  @tracked announced: CopyState = 'idle';

  constructor(owner: Owner, args: CopyButtonSignature['Args']) {
    super(owner, args);
    registerDestructor(this, () => this.clearResetTimer());
  }

  // Fixed through the result, so voice control keeps matching it; the status
  // region announces the result instead. An empty name is no name.
  get label() {
    return (
      firstDefined(this.args.label, this.args.ariaLabel) || 'Copy to clipboard'
    );
  }
  get text() {
    return firstDefined(this.args.text, this.args.value, this.args.textToCopy);
  }
  get copied() {
    return this.state === 'copied';
  }
  get failed() {
    return this.state === 'failed';
  }
  get dataState() {
    return this.state === 'idle' ? undefined : this.state;
  }
  get statusText() {
    return STATUS_TEXT[this.announced];
  }
  get glyph(): 'copy' | 'check' | 'cross' {
    return this.copied ? 'check' : this.failed ? 'cross' : 'copy';
  }
  // Which copy is in flight; a result from an earlier click is dropped, so a
  // slow failure never overwrites a newer success.
  private attempt = 0;
  private resetTimer: ReturnType<typeof setTimeout> | undefined;
  private clearResetTimer() {
    if (this.resetTimer !== undefined) {
      clearTimeout(this.resetTimer);
      this.resetTimer = undefined;
    }
  }
  private settle(result: CopyState) {
    this.state = result;
    this.announced = result;
    this.clearResetTimer();
    this.resetTimer = setTimeout(() => this.reset(), RESET_MS);
  }
  copy = (_e: Event) => {
    let text = this.text;
    if (text == null) {
      return;
    }
    // a repeat copy clears the region first, so the result is announced again
    let attempt = ++this.attempt;
    this.announced = 'idle';
    // absent outside a secure context, and writeText can throw synchronously
    let write: Promise<void>;
    try {
      write = navigator.clipboard.writeText(text);
    } catch (error) {
      write = Promise.reject(error);
    }
    write.then(
      () => {
        if (attempt === this.attempt) {
          this.settle('copied');
        }
      },
      (error: unknown) => {
        if (attempt === this.attempt) {
          this.settle('failed');
        }
        console.error(error instanceof Error ? error.message : error);
      },
    );
  };
  reset = () => {
    this.attempt++;
    this.clearResetTimer();
    this.state = 'idle';
    this.announced = 'idle';
  };
  <template>
    <IconButton
      @label={{this.label}}
      @tone={{@tone}}
      @appearance={{@appearance}}
      @variant={{@variant}}
      @size={{@size}}
      @disabled={{@disabled}}
      data-state={{this.dataState}}
      {{on 'click' this.copy}}
      data-test-pretui-copy-button
      ...attributes
    >
      {{! all three glyphs stay in the DOM and cross-fade, so the result
          both enters and leaves smoothly; the copy glyph sets the size }}
      <span
        class='pretui-copy-glyphs'
        data-glyph={{this.glyph}}
        data-test-pretui-copy-button-glyph
      >
        <CopyIcon
          class='pretui-copy-glyph pretui-copy-idle'
          width={{ICON_SIZE}}
          height={{ICON_SIZE}}
        />
        <CheckIcon
          class='pretui-copy-glyph pretui-copy-check'
          width={{ICON_SIZE}}
          height={{ICON_SIZE}}
        />
        <XIcon
          class='pretui-copy-glyph pretui-copy-failed'
          width={{ICON_SIZE}}
          height={{ICON_SIZE}}
        />
      </span>
    </IconButton>
    {{! outside the button, whose children are presentational; always rendered
        so assistive tech is already watching it when the text arrives }}
    <VisuallyHidden
      role='status'
      data-test-pretui-copy-button-status
    >{{this.statusText}}</VisuallyHidden>
    <style scoped>
      @layer PretComponent {
        .pretui-copy-glyphs {
          position: relative;
          display: inline-flex;
        }
        .pretui-copy-glyph {
          scale: 0.25;
          opacity: 0;
          filter: blur(4px);
        }
        .pretui-copy-check,
        .pretui-copy-failed {
          position: absolute;
          inset: 0;
        }
        .pretui-copy-glyphs[data-glyph='copy'] .pretui-copy-idle,
        .pretui-copy-glyphs[data-glyph='check'] .pretui-copy-check,
        .pretui-copy-glyphs[data-glyph='cross'] .pretui-copy-failed {
          scale: 1;
          opacity: 1;
          filter: blur(0);
        }
        @media (prefers-reduced-motion: no-preference) {
          .pretui-copy-glyph {
            transition-property: scale, opacity, filter;
            transition-duration: 300ms;
            transition-timing-function: cubic-bezier(0.2, 0, 0, 1);
          }
        }
        .pretui-copy-check {
          color: var(--success-ink);
        }
        .pretui-copy-failed {
          color: var(--destructive-ink);
        }
        /* an -ink tone loses contrast on a fill (the cross on a filled hover
           surface measures under 3:1), so there the glyph keeps the fill's
           own text color and its shape carries the result */
        [data-appearance='accent'] .pretui-copy-check,
        [data-appearance='accent'] .pretui-copy-failed,
        [data-appearance='filled'] .pretui-copy-check,
        [data-appearance='filled'] .pretui-copy-failed,
        [data-appearance='filled-outlined'] .pretui-copy-check,
        [data-appearance='filled-outlined'] .pretui-copy-failed {
          color: inherit;
        }
      }
    </style>
  </template>
}
