// Pretui — CopyButton: an IconButton that copies text to the clipboard.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { IconButton, iconSizeFor } from './icon-button';
import { firstDefined } from '../pretui-primitives';
import type { IconButtonSignature } from './icon-button';
import type { PretuiSizeArg } from '../pretui-primitives';

// Fresh small. boxel-ui's copy-button rides Tooltip (ember-velcro
// wormhole — wart list forbids); this one is an IconButton that copies
// @text to the clipboard and swaps its glyph while the result holds.
// Wave-0 adaptation: no setTimeout in the realm, so the state resets on
// pointerleave/blur instead of a 2s timer — the result lives exactly as
// long as the pointer lingers.

type CopyState = 'idle' | 'copied' | 'failed';

const STATUS_TEXT: Record<CopyState, string> = {
  idle: '',
  copied: 'Copied',
  failed: 'Copy failed',
};

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
    variant?: IconButtonSignature['Args']['variant'];
    size?: PretuiSizeArg;
    disabled?: boolean;
  };
  Element: HTMLButtonElement;
}

export class CopyButton extends Component<CopyButtonSignature> {
  @tracked state: CopyState = 'idle';

  // Fixed through the result, so voice control keeps matching it; the status
  // region announces the result instead.
  get label() {
    return (
      firstDefined(this.args.label, this.args.ariaLabel) ?? 'Copy to clipboard'
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
    return STATUS_TEXT[this.state];
  }
  get glyphSize() {
    return iconSizeFor(this.args.size);
  }
  copy = (_e: Event) => {
    let text = this.text;
    if (text == null) {
      return;
    }
    navigator.clipboard.writeText(text).then(
      () => {
        this.state = 'copied';
      },
      (error: unknown) => {
        this.state = 'failed';
        console.error(error instanceof Error ? error.message : error);
      },
    );
  };
  reset = (_e: Event) => {
    this.state = 'idle';
  };
  <template>
    <IconButton
      @label={{this.label}}
      @variant={{@variant}}
      @size={{@size}}
      @disabled={{@disabled}}
      data-state={{this.dataState}}
      data-test-pretui-copy-button
      {{on 'click' this.copy}}
      {{on 'pointerleave' this.reset}}
      {{on 'blur' this.reset}}
      ...attributes
    >
      {{#if this.copied}}
        <svg
          class='pretui-copy-check'
          width={{this.glyphSize}}
          height={{this.glyphSize}}
          viewBox='0 0 14 14'
        ><path
            d='M2.5 7.5 5.5 10.5 11.5 3.5'
            fill='none'
            stroke='currentColor'
            stroke-width='1.6'
            stroke-linecap='round'
            stroke-linejoin='round'
          /></svg>
      {{else if this.failed}}
        <svg
          class='pretui-copy-failed'
          width={{this.glyphSize}}
          height={{this.glyphSize}}
          viewBox='0 0 14 14'
        ><path
            d='M3.5 3.5 10.5 10.5M10.5 3.5 3.5 10.5'
            fill='none'
            stroke='currentColor'
            stroke-width='1.6'
            stroke-linecap='round'
          /></svg>
      {{else}}
        <svg
          width={{this.glyphSize}}
          height={{this.glyphSize}}
          viewBox='0 0 14 14'
        ><rect
            x='4.75'
            y='4.75'
            width='7.5'
            height='7.5'
            rx='1.75'
            fill='none'
            stroke='currentColor'
            stroke-width='1.3'
          /><path
            d='M9.25 3.25v-.5a1.5 1.5 0 0 0-1.5-1.5h-4.5a1.5 1.5 0 0 0-1.5 1.5v4.5a1.5 1.5 0 0 0 1.5 1.5h.5'
            fill='none'
            stroke='currentColor'
            stroke-width='1.3'
            stroke-linecap='round'
          /></svg>
      {{/if}}
    </IconButton>
    {{! outside the button, whose children are presentational; always rendered
        so assistive tech is already watching it when the text arrives }}
    <span
      class='pretui-copy-status'
      role='status'
      data-test-pretui-copy-button-status
    >{{this.statusText}}</span>
    <style scoped>
      @layer PretComponent {
        .pretui-copy-check {
          color: var(--success-ink);
        }
        .pretui-copy-failed {
          color: var(--destructive-ink);
        }
        /* an -ink tone loses contrast on an accent fill, so the glyph keeps
           the fill's paired foreground and its shape carries the result */
        [data-appearance='accent'] .pretui-copy-check,
        [data-appearance='accent'] .pretui-copy-failed {
          color: inherit;
        }
        .pretui-copy-status {
          position: absolute;
          width: 1px;
          height: 1px;
          overflow: hidden;
          clip-path: inset(50%);
          white-space: nowrap;
        }
      }
    </style>
  </template>
}
