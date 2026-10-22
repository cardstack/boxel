// Pretui — FileTrigger: a button that opens the file picker and screens what comes back.
import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { modifier } from 'ember-modifier';
import { Button } from './button';
import type { PretuiAppearance, PretuiSize, PretuiTone } from '../pretui-primitives';

// ═══════════════════════════════════════════════════════════════════════
// FileTrigger
// ═══════════════════════════════════════════════════════════════════════

/** What a caller-supplied trigger block receives. */
export interface FileTriggerApi {
  /** opens the platform file picker */
  open: () => void;
  /** true when the trigger is inert */
  disabled: boolean;
}

export interface FileTriggerSignature {
  Args: {
    /** an `<input accept>` list — `'image/*, .csv'`. Filters the picker AND,
     * when this trigger sits inside a Dropzone, the drop path. */
    accept?: string;
    /** allow selecting more than one file */
    multiple?: boolean;
    /** pick a whole directory (`webkitdirectory`). Support is uneven; the
     * button still opens a normal picker where it is unsupported. */
    directory?: boolean;
    /** ask a mobile camera for the capture rather than the photo library */
    capture?: 'user' | 'environment';
    /** the button's text, and the encapsulated input's accessible name */
    label?: string;
    /** dimmed and inert */
    disabled?: boolean;
    /** treatment axes, forwarded to the default Button */
    tone?: PretuiTone;
    appearance?: PretuiAppearance;
    size?: PretuiSize;
    /** receives the chosen files. Never called with an empty list. */
    onSelect?: (files: File[]) => void;
  };
  Blocks: {
    /** replace the default button entirely; wire `api.open` to whatever
     * control you render. Supplying this block is the only supported way to
     * change the trigger — the button is a slot, not a set of strings. */
    default: [FileTriggerApi];
  };
  Element: HTMLSpanElement;
}

// NOTE — no `id` on the encapsulated input, deliberately: realm lint's
// `require-input-label` counts a dynamic `id` as a possible `<label for>`
// target, so `id` + `aria-label` reads to it as TWO labels and errors. The id
// bought nothing here — the trigger drives the input through a captured
// element reference, never through the DOM id — so `aria-label` is the
// single, unambiguous accessible name.
export class FileTrigger extends Component<FileTriggerSignature> {
  // Deliberately NOT @tracked: written from inside a modifier body and read
  // only from an event handler, never during render. A tracked property
  // written from a modifier and read in the same computation is a
  // backtracking re-render. Same reasoning as menu.gts's `triggerEl`.
  private inputEl: HTMLInputElement | undefined;

  get label(): string {
    return this.args.label ?? 'Choose files';
  }
  get api(): FileTriggerApi {
    return {
      open: this.open,
      disabled: this.args.disabled ?? false,
    };
  }

  /** Glimmer binds a dynamic attribute through the element PROPERTY when one
   * exists, so `multiple={{''}}` assigns a FALSY empty string and the flag
   * never turns on — it parses, lints and indexes clean, and simply does
   * nothing. `true | undefined` is correct on both the property and the
   * attribute path; `false` would write the *present* attribute `="false"`.
   * (The same fix MediaPlayer makes.) */
  private flag(wanted: boolean | undefined): true | undefined {
    return wanted ? true : undefined;
  }
  get multipleAttr(): true | undefined {
    return this.flag(this.args.multiple);
  }
  get disabledAttr(): true | undefined {
    return this.flag(this.args.disabled);
  }

  /** Holds the input element, and applies the two intake flags Glint's
   * attribute types do not know about (`webkitdirectory` is non-standard,
   * `capture` is mobile-only), so neither can be written as a template
   * attribute at all. For `webkitdirectory` the PROPERTY is the correct
   * binding anyway — see `flag` above. */
  private captures = modifier(
    (
      el: HTMLInputElement,
      [directory, capture]: [boolean | undefined, string | undefined],
    ) => {
      this.inputEl = el;
      el.webkitdirectory = directory === true;
      if (capture === 'user' || capture === 'environment') {
        el.setAttribute('capture', capture);
      } else {
        el.removeAttribute('capture');
      }
      return () => {
        if (this.inputEl === el) {
          this.inputEl = undefined;
        }
      };
    },
  );

  open = () => {
    if (this.args.disabled) {
      return;
    }
    this.inputEl?.click();
  };

  onChange = (event: Event) => {
    let input = event.target as HTMLInputElement;
    let files = Array.from(input.files ?? []);
    // Reset so choosing the SAME file twice in a row still fires `change`.
    // The File objects are already captured above, so this loses nothing.
    input.value = '';
    if (files.length > 0) {
      this.args.onSelect?.(files);
    }
  };

  <template>
    <span class='pretui-filetrigger' data-test-pretui-file-trigger ...attributes>
      {{! The real input. Visually hidden but present and functional — a
          Dropzone without one is a pointer-only control. }}
      {{! No id on this input, deliberately — see the note above the class. }}
      <input
        type='file'
        class='pretui-filetrigger-input'
        aria-label={{this.label}}
        tabindex='-1'
        accept={{@accept}}
        multiple={{this.multipleAttr}}
        disabled={{this.disabledAttr}}
        {{this.captures @directory @capture}}
        {{on 'change' this.onChange}}
      />
      {{#if (has-block)}}
        {{yield this.api}}
      {{else}}
        <Button
          @tone={{@tone}}
          @appearance={{if @appearance @appearance 'outlined'}}
          @size={{@size}}
          @disabled={{@disabled}}
          data-test-pretui-file-trigger-button
          {{on 'click' this.open}}
        >{{this.label}}</Button>
      {{/if}}
    </span>
    <style scoped>
      @layer PretComponent {
        .pretui-filetrigger {
          display: inline-flex;
        }
        /* Clipped rather than display:none — a display:none input is not
           guaranteed to accept a programmatic click in every engine, and it
           drops out of the form entirely. */
        .pretui-filetrigger-input {
          position: absolute;
          width: 1px;
          height: 1px;
          padding: 0;
          margin: -1px;
          overflow: hidden;
          clip: rect(0 0 0 0);
          white-space: nowrap;
          border: 0;
        }
      }
    </style>
  </template>
}
