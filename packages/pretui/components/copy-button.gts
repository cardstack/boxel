// Pretui — CopyButton: an IconButton that copies text to the clipboard.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { IconButton } from './icon-button';
import { firstDefined } from '../pretui-primitives';
import type { IconButtonSignature } from './icon-button';
import type { PretuiSizeArg } from '../pretui-primitives';

// Fresh small. boxel-ui's copy-button rides Tooltip (ember-velcro
// wormhole — wart list forbids); this one is an IconButton that copies
// @text to the clipboard and swaps its glyph to a success check while the
// "copied" state holds. Wave-0 adaptation: no setTimeout in the realm, so
// the state resets on pointerleave/blur instead of a 2s timer — the
// confirmation lives exactly as long as the pointer lingers.

export interface CopyButtonSignature {
  Args: {
    text?: string | null | undefined;
    /** alias — the clipboard payload is this control's value, and `@value`
     * is what Chakra/Ant/Mantine's Clipboard all call it */
    value?: string | null | undefined;
    /** accessible name while idle — 'Copy to clipboard' by default */
    label?: string;
    variant?: IconButtonSignature['Args']['variant'];
    size?: PretuiSizeArg;
  };
  Element: HTMLButtonElement;
}

export class CopyButton extends Component<CopyButtonSignature> {
  @tracked copied = false;

  get label() {
    return this.copied ? 'Copied' : (this.args.label ?? 'Copy to clipboard');
  }
  get text() {
    return firstDefined(this.args.text, this.args.value);
  }
  copy = (_e: Event) => {
    let text = this.text;
    if (text == null) {
      return;
    }
    navigator.clipboard.writeText(text).then(
      () => {
        this.copied = true;
      },
      (error: unknown) => {
        console.error(error instanceof Error ? error.message : error);
      },
    );
  };
  reset = (_e: Event) => {
    this.copied = false;
  };
  <template>
    <IconButton
      @label={{this.label}}
      @variant={{@variant}}
      @size={{@size}}
      data-state={{if this.copied 'copied'}}
      data-test-pretui-copy-button
      {{on 'click' this.copy}}
      {{on 'pointerleave' this.reset}}
      {{on 'blur' this.reset}}
      ...attributes
    >
      {{#if this.copied}}
        <svg
          class='pretui-copy-check'
          width='13'
          height='13'
          viewBox='0 0 14 14'
          aria-hidden='true'
        ><path
            d='M2.5 7.5 5.5 10.5 11.5 3.5'
            fill='none'
            stroke='currentColor'
            stroke-width='1.6'
            stroke-linecap='round'
            stroke-linejoin='round'
          /></svg>
      {{else}}
        <svg
          width='13'
          height='13'
          viewBox='0 0 14 14'
          aria-hidden='true'
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
    <style scoped>
      .pretui-copy-check {
        color: var(--success, var(--boxel-success));
      }
    </style>
  </template>
}
