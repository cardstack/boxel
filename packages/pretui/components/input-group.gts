// Pretui — InputGroup: boxel-ui's input group in Pretui cloth.
import Component from '@glimmer/component';
import { BoxelInputGroup } from '@cardstack/boxel-ui/components';
import { emit, firstDefined } from '../pretui-primitives';
import type { ControlAliasArgs } from '../pretui-primitives';

// Rebuilt ON boxel-ui's InputGroup (standing reuse directive — supersedes
// the wave-0 fresh-minimal cut): the whole contextual-component surface is
// now live. The Pretui blocks map onto boxel's:
//   <:start>/<:end>   plain content, auto-wrapped in Accessories.Text —
//                     the original Pretui surface, preserved.
//   <:before>/<:after> pass boxel's Accessories through (Button /
//                     IconButton / Select / Text) for composite groups.
//   <:default>        passes boxel's Controls (Input / Textarea) +
//                     Accessories + {elementId} through for multi-control
//                     groups; boxel then ignores @value/@placeholder/@type.
// Validation graduates from boolean @invalid (kept) to boxel's @state enum
// + @errorMessage/@helperText rows. The wrapper div carries the Pretui
// re-skin via the semantic-token + --boxel-* channel; splatted attributes
// stay on the wrapper. Known wart (accepted): the Select accessory's
// dropdown portals to boxel's wormhole, so it wears boxel default colors,
// not Pretui tokens (accessory has no @renderInPlace passthrough).
// The yielded block-arg types are re-asserted locally (asAccessories /
// asControls casts) because boxel's AccessoriesBlockArg type rides
// @glint/template, which realm code cannot import.

export type InputGroupState =
  | 'none'
  | 'valid'
  | 'invalid'
  | 'loading'
  | 'initial';

interface IGButtonSignature {
  Args: { disabled?: boolean; kind?: string };
  Blocks: { default: [] };
  Element: HTMLButtonElement | HTMLAnchorElement;
}
interface IGIconButtonSignature {
  Args: {
    disabled?: boolean;
    height?: string;
    icon?: unknown;
    width?: string;
  };
  Blocks: { default: [] };
  Element: HTMLButtonElement | HTMLAnchorElement;
}
interface IGTextSignature {
  Args: unknown;
  Blocks: { default: [] };
  Element: HTMLSpanElement;
}
interface IGSelectSignature {
  Args: {
    disabled?: boolean;
    dropdownClass?: string;
    matchTriggerWidth?: boolean;
    onChange: (item: unknown) => void;
    options: unknown[];
    placeholder?: string;
    searchEnabled?: boolean;
    searchField?: string;
    selected?: unknown;
  };
  Blocks: { default: [unknown] };
  Element: HTMLElement;
}
interface IGInputSignature {
  Args: {
    disabled?: boolean;
    onBlur?: (ev: Event) => void;
    onFocus?: (ev: Event) => void;
    onInput?: (val: string) => void;
    placeholder?: string;
    readonly?: boolean;
    required?: boolean;
    value?: string | null;
  };
  Element: HTMLInputElement;
}
interface IGTextareaSignature {
  Args: { placeholder?: string; value?: string | null };
  Element: HTMLTextAreaElement;
}

type IGComponent<S> = new (
  owner: unknown,
  args: S extends { Args: infer A } ? A : never,
) => Component<S>;

export interface InputGroupAccessories {
  Button: IGComponent<IGButtonSignature>;
  IconButton: IGComponent<IGIconButtonSignature>;
  Select: IGComponent<IGSelectSignature>;
  Text: IGComponent<IGTextSignature>;
}
export interface InputGroupControls {
  Input: IGComponent<IGInputSignature>;
  Textarea: IGComponent<IGTextareaSignature>;
}
export interface InputGroupApi {
  elementId: string;
}

function asAccessories(a: unknown): InputGroupAccessories {
  return a as InputGroupAccessories;
}
function asControls(c: unknown): InputGroupControls {
  return c as InputGroupControls;
}

export interface InputGroupSignature {
  Args: ControlAliasArgs & {
    value?: string;
    placeholder?: string;
    type?: string;
    disabled?: boolean;
    /** kept — sugar for @state='invalid' */
    invalid?: boolean;
    controlId?: string;
    onInput?: (value: string) => void;
    /** additive — boxel's validation-state enum; wins over @invalid */
    state?: InputGroupState;
    /** additive — error row under the group; renders while state=invalid */
    errorMessage?: string;
    /** additive — helper row under the group */
    helperText?: string;
    /** additive — forwarded to the built-in input */
    required?: boolean;
    readonly?: boolean;
    autocomplete?: string;
    /** alias — React Aria / Base UI spelling of @invalid */
    isInvalid?: boolean;
  };
  Blocks: {
    start: [];
    end: [];
    before: [InputGroupAccessories, InputGroupApi];
    after: [InputGroupAccessories, InputGroupApi];
    default: [InputGroupControls, InputGroupAccessories, InputGroupApi];
  };
  Element: HTMLDivElement;
}

export class InputGroup extends Component<InputGroupSignature> {
  get invalid() {
    return firstDefined(this.args.invalid, this.args.isInvalid) ?? false;
  }
  get disabled() {
    return firstDefined(this.args.disabled, this.args.isDisabled);
  }
  get required() {
    return firstDefined(this.args.required, this.args.isRequired);
  }
  get readonly() {
    return firstDefined(
      this.args.readonly,
      this.args.isReadOnly,
      this.args.readOnly,
    );
  }
  get state(): InputGroupState | undefined {
    return this.args.state ?? (this.invalid ? 'invalid' : undefined);
  }
  handleInput = (value: string) => {
    emit(
      [this.args.onInput, this.args.onChange, this.args.onValueChange],
      value,
    );
  };
  <template>
    <div
      class='pretui-boxelwrap pretui-inputgroup'
      data-state={{this.state}}
      data-disabled={{if this.disabled 'true'}}
      data-test-pretui-input-group
      ...attributes
    >
      {{#if (has-block)}}
        {{! Consumer supplies the controls — boxel skips its built-in input. }}
        <BoxelInputGroup
          @id={{@controlId}}
          @disabled={{this.disabled}}
          @state={{this.state}}
          @errorMessage={{@errorMessage}}
          @helperText={{@helperText}}
        >
          <:before as |Accessories group|>
            {{#if (has-block 'start')}}
              <Accessories.Text>{{yield to='start'}}</Accessories.Text>
            {{/if}}
            {{yield (asAccessories Accessories) group to='before'}}
          </:before>
          <:default as |Controls Accessories group|>
            {{yield
              (asControls Controls)
              (asAccessories Accessories)
              group
            }}
          </:default>
          <:after as |Accessories group|>
            {{yield (asAccessories Accessories) group to='after'}}
            {{#if (has-block 'end')}}
              <Accessories.Text>{{yield to='end'}}</Accessories.Text>
            {{/if}}
          </:after>
        </BoxelInputGroup>
      {{else}}
        <BoxelInputGroup
          @id={{@controlId}}
          @value={{@value}}
          @placeholder={{@placeholder}}
          @type={{@type}}
          @disabled={{this.disabled}}
          @readonly={{this.readonly}}
          @required={{this.required}}
          @autocomplete={{@autocomplete}}
          @state={{this.state}}
          @errorMessage={{@errorMessage}}
          @helperText={{@helperText}}
          @onInput={{this.handleInput}}
        >
          <:before as |Accessories group|>
            {{#if (has-block 'start')}}
              <Accessories.Text>{{yield to='start'}}</Accessories.Text>
            {{/if}}
            {{yield (asAccessories Accessories) group to='before'}}
          </:before>
          <:after as |Accessories group|>
            {{yield (asAccessories Accessories) group to='after'}}
            {{#if (has-block 'end')}}
              <Accessories.Text>{{yield to='end'}}</Accessories.Text>
            {{/if}}
          </:after>
        </BoxelInputGroup>
      {{/if}}
    </div>
    <style scoped>
      @layer PretComponent {
        /* Input's field style via the token channel; the text accessories
           and the helper row take the step below the field's text */
        .pretui-inputgroup {
          width: 100%;
          font-size: var(--boxel-font-size-xs);
          letter-spacing: var(--boxel-lsp-xs);
          /* the group's input inherits this line-height, and its padding-block
             is --boxel-sp-xxs: the line-height token assumes 0.25rem */
          line-height: var(--boxel-form-control-line-height-sm);
          --boxel-sp-xxs: 0.25rem;
          --background: var(--field);
          --border: var(--input);
          --boxel-form-control-height: var(--boxel-form-control-height-sm);
          /* the group's controls inherit its min-height inside its 1px
             border, so the knob is the height less both borders */
          --boxel-input-height: calc(var(--boxel-form-control-height-sm) - 2px);
          --boxel-form-control-border-radius: calc(var(--radius) - 0.125rem);
          --boxel-font-size-sm: var(--boxel-font-size-2xs);
          /* a Button add-on's own 14px text overflows the height */
          --boxel-button-font: 700 var(--boxel-font-size-2xs) /
            var(--boxel-form-control-line-height-sm) var(--boxel-font-family);
          --boxel-sp-xs: var(--boxel-sp-3xs);
          --boxel-sp-sm: calc(0.625rem - 1px);
        }
        /* iOS zooms into inputs under 16px on focus */
        @media (pointer: coarse) {
          .pretui-inputgroup {
            font-size: var(--boxel-form-control-touch-font-size);
          }
        }
        /* the group dims once; its inputs don't dim again inside it */
        .pretui-inputgroup[data-disabled] {
          --boxel-input-disabled-opacity: 1;
          opacity: var(--boxel-disabled-opacity);
        }
      }
    </style>
  </template>
}
