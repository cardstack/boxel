// Pretui — PasswordInput usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from '../freestyle';
import { PasswordInput } from './password-input';

// ── PasswordInput — typed-input split, fresh page ────────────────────────
// Type-specific knobs: revealable (the eye toggle on/off), autocomplete
// (current-password / new-password / off / one-time-code), and strength
// (the opt-in zxcvbn meter — off by default, and the 839 KB estimator is
// not fetched until it is switched on and something is typed).
const AUTOCOMPLETE_OPTIONS = [
  'current-password',
  'new-password',
  'off',
  'one-time-code',
];

// What a signup form would already know about the user. zxcvbn scores
// against these, which is why 'chris1985' reads as weak here.
const DEMO_USER_INPUTS = ['Chris', 'Tse', 'chris@example.com', 'Cardstack'];

class PasswordInputUsage extends Component {
  autocompleteOptions = AUTOCOMPLETE_OPTIONS;
  @tracked value = 'hunter2';
  @tracked placeholder = 'Password';
  @tracked autocomplete = 'current-password';
  @tracked revealable = true;
  @tracked disabled = false;
  @tracked required = false;
  @tracked strength = true;
  @tracked userInputs: string[] = DEMO_USER_INPUTS;
  setValue = (v: string) => (this.value = v);
  setPlaceholder = (v: string) => (this.placeholder = v);
  setAutocomplete = (v: string) => (this.autocomplete = v);
  setRevealable = (v: boolean) => (this.revealable = v);
  setDisabled = (v: boolean) => (this.disabled = v);
  setRequired = (v: boolean) => (this.required = v);
  setStrength = (v: boolean) => (this.strength = v);
  setUserInputs = (v: string[]) => (this.userInputs = v);
  /** The demo never echoes the value — a password readout is a password in
   * the DOM as text, which is exactly what the component is careful not to
   * do. Length is enough to show that @onInput fired. */
  get readout() {
    return this.value.length;
  }
  get usage() {
    let bits = [`@value='${this.value}'`];
    if (this.autocomplete !== 'current-password')
      bits.push(`@autocomplete='${this.autocomplete}'`);
    if (!this.revealable) bits.push('@revealable={{false}}');
    if (this.strength) bits.push('@strength={{true}}');
    if (this.strength && this.userInputs.length)
      bits.push('@userInputs={{this.userInputs}}');
    bits.push('@onInput={{this.setValue}}');
    return `<PasswordInput ${bits.join(' ')} />`;
  }
  <template>
    <FreestyleUsage
      @name='PasswordInput'
      @description="Password entry riding boxel-ui BoxelInput (@type=password) plus the reveal toggle boxel-ui doesn't ship — the eye button flips the native type to text while pressed state holds (aria-pressed carries it for assistive tech). Strength estimation is opt-in: switch it on and the zxcvbn estimator is fetched on the first settled keystroke, never before. It is advice — nothing here gates submission, and per NIST 800-63B a long passphrase with no symbols beats a short one that has them. Try 'chris1985' with and without userInputs."
      @source={{this.usage}}
    >
      <:example>
        <PasswordInput
          @value={{this.value}}
          @placeholder={{this.placeholder}}
          @autocomplete={{this.autocomplete}}
          @revealable={{this.revealable}}
          @disabled={{this.disabled}}
          @required={{this.required}}
          @strength={{this.strength}}
          @userInputs={{this.userInputs}}
          @onInput={{this.setValue}}
        />
        <p class='pretui-demo-readout' data-test-password-readout>
          onInput fired — {{this.readout}} characters (never echoed)
        </p>
      </:example>
      <:api as |Args|>
        <Args.Bool
          @name='revealable'
          @defaultValue={{true}}
          @value={{this.revealable}}
          @description='Show the reveal (eye) toggle. Off for high-security contexts.'
          @onInput={{this.setRevealable}}
        />
        <Args.String
          @name='autocomplete'
          @defaultValue='current-password'
          @value={{this.autocomplete}}
          @options={{this.autocompleteOptions}}
          @description='Autocomplete hint — new-password asks the browser to suggest one; off opts out.'
          @onInput={{this.setAutocomplete}}
        />
        <Args.String
          @name='value'
          @value={{this.value}}
          @onInput={{this.setValue}}
        />
        <Args.String
          @name='placeholder'
          @value={{this.placeholder}}
          @onInput={{this.setPlaceholder}}
        />
        <Args.Bool
          @name='disabled'
          @value={{this.disabled}}
          @onInput={{this.setDisabled}}
        />
        <Args.Bool
          @name='required'
          @value={{this.required}}
          @onInput={{this.setRequired}}
        />
        <Args.Bool
          @name='strength'
          @defaultValue={{false}}
          @value={{this.strength}}
          @description='Render the strength meter. Opt-in (Law 9) — with it off the zxcvbn estimator is not on the import graph at all, and with it on the bundle is fetched by the first estimate rather than by render.'
          @onInput={{this.setStrength}}
        />
        <Args.Array
          @name='userInputs'
          @value={{this.userInputs}}
          @description="What you already know about the user — name, email, handle, company. zxcvbn scores against them, so 'chris1985' stops reading as strong. The single highest-value arg: clear this field and watch the same password score higher."
          @onInput={{this.setUserInputs}}
        />
        <Args.String
          @name='controlId'
          @description="The input's id for label wiring — supplied by a wrapping Field's yielded controlId."
        />
        <Args.Action
          @name='onInput'
          @description='Receives the changed value as a string.'
        />
        <Args.Action
          @name='onStrength'
          @description='Receives each settled estimate. Advice, not a gate — do not wire it to a submit button.'
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .pretui-demo-readout {
        margin: 8px 0 0;
        font-family: var(--font-mono);
        font-size: var(--text-ui-xs, 11px);
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export const DEMOS_PASSWORD_INPUT: Record<string, unknown> = {
  PasswordInput: PasswordInputUsage,
};
