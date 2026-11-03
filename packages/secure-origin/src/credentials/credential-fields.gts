import { on } from '@ember/modifier';
import Component from '@glimmer/component';

import FieldContainer from '../components/field-container.gts';
import BoxelInput from '../components/input.gts';
import cn from '../helpers/cn.ts';
import { modifier, testAttribute } from '../modifiers/modifier.ts';
import type { CredentialFrame } from '../security/credentials.js';
import type { Changes } from './changes.ts';

// The credential fields the app frames, drawn the way the app draws its own:
// the settings modal's in a horizontal FieldContainer, and the change-email
// modal's confirmation in a vertical one. What the fields hold,
// and everything said to the app about them, is the `CredentialFrame`'s; this
// only draws it and reports to it what is typed.

interface Field {
  name: string;
  label?: string;
  type: 'text' | 'password';
  id?: string;
  inputName?: string;
  autocomplete: string;
  placeholder?: string;
  testId: string;
  accessibleName?: string;
  validate?: 'new' | 'confirm';
}

interface Signature {
  Args: {
    frame: CredentialFrame;
    changes: Changes;
  };
}

interface FieldView {
  name: string;
  field: Field;
  value: string;
  error: string | undefined;
}

// The frame reports the height of the fields whenever their layout changes
// it.
const observeSize = modifier((element: HTMLElement, frame: CredentialFrame) => {
  let observer = new ResizeObserver(() => frame.sendSize());
  observer.observe(element);
  return () => observer.disconnect();
});

export default class CredentialFields extends Component<Signature> {
  private get frame() {
    return this.args.frame;
  }

  private get layout(): 'settings' | 'modal' {
    return this.frame.form.layout;
  }

  private get narrow(): boolean {
    this.args.changes.consume();
    return this.frame.narrow;
  }

  private get hiddenUsername(): string {
    this.args.changes.consume();
    return this.frame.hiddenUsername;
  }

  private get fields(): FieldView[] {
    this.args.changes.consume();
    return [...this.frame.fields.values()].map(({ field, value, error }) => ({
      name: field.name,
      field,
      value,
      error,
    }));
  }

  // A field with an error is shown invalid, as a BoxelInput given
  // `@state='invalid'` is. The forms whose fields the app gives a validation
  // state show the rest as `initial`; the others give them none.
  private state = (error: string | undefined) => {
    if (error) {
      return 'invalid';
    }
    return this.frame.form.stateful ? 'initial' : undefined;
  };

  private input = (name: string) => (value: string) =>
    this.frame.input(name, value);

  // A value can reach a field with no `input` event, from a filler that sets
  // it and dispatches only `change`. The frame takes it from `change` too,
  // but only when it differs from what the frame holds, so the `change` that
  // follows typing doesn't clear an error.
  private change = (name: string) => (event: Event) => {
    let { value } = event.target as HTMLInputElement;
    if (value !== this.frame.value(name)) {
      this.frame.input(name, value);
    }
  };

  private blur = (name: string) => () => this.frame.blur(name);

  private keydown = (event: Event) => {
    if ((event as KeyboardEvent).key === 'Enter') {
      event.preventDefault();
      this.frame.enter();
    }
  };

  // The form is never sent: a request goes when the app asks for it, made
  // by the frame. It is submitted only so a password manager sees it go.
  private preventSubmit = (event: Event) => event.preventDefault();

  private isLayout = (layout: string) => this.layout === layout;

  <template>
    <form
      id='credential-fields'
      class={{cn
        'credential-fields'
        (concatLayout this.layout)
        narrow=this.narrow
      }}
      novalidate
      {{on 'submit' this.preventSubmit}}
      {{observeSize this.frame}}
      data-test-credential-fields-form={{this.layout}}
    >
      {{#if this.frame.form.hiddenUsername}}
        {{! Gives a password manager the account a new password belongs to.
          It is hidden from everyone else, so it has no label. }}
        {{! template-lint-disable require-input-label }}
        <input
          type='text'
          name='username'
          autocomplete='username'
          aria-hidden='true'
          hidden
          tabindex='-1'
          value={{this.hiddenUsername}}
        />
        {{! template-lint-enable require-input-label }}
      {{/if}}
      {{#each this.fields key='name' as |entry|}}
        {{#if (this.isLayout 'settings')}}
          <FieldContainer
            @label={{entry.field.label}}
            @tag='label'
            class='profile-field password-settings-field'
            as |labelId|
          >
            <BoxelInput
              @id={{entry.field.id}}
              @type={{entry.field.type}}
              @autocomplete={{entry.field.autocomplete}}
              @placeholder={{entry.field.placeholder}}
              @value={{entry.value}}
              @state={{this.state entry.error}}
              @errorMessage={{entry.error}}
              @onInput={{this.input entry.name}}
              @onBlur={{this.blur entry.name}}
              @onChange={{this.change entry.name}}
              name={{entry.field.inputName}}
              aria-labelledby={{labelId}}
              aria-label={{entry.field.accessibleName}}
              {{on 'keydown' this.keydown}}
              {{testAttribute entry.field.testId}}
            />
          </FieldContainer>
        {{else}}
          <FieldContainer
            @label={{entry.field.label}}
            @tag='label'
            @vertical={{true}}
            class='profile-field'
            as |labelId|
          >
            <BoxelInput
              @id={{entry.field.id}}
              @type={{entry.field.type}}
              @autocomplete={{entry.field.autocomplete}}
              @placeholder={{entry.field.placeholder}}
              @value={{entry.value}}
              @state={{this.state entry.error}}
              @errorMessage={{entry.error}}
              @onInput={{this.input entry.name}}
              @onBlur={{this.blur entry.name}}
              @onChange={{this.change entry.name}}
              name={{entry.field.inputName}}
              aria-labelledby={{labelId}}
              aria-label={{entry.field.accessibleName}}
              {{on 'keydown' this.keydown}}
              {{testAttribute entry.field.testId}}
            />
          </FieldContainer>
        {{/if}}
      {{/each}}
    </form>
    <style scoped>
      @layer boxelComponentL1, boxelComponentL2;

      @font-face {
        font-family: 'IBM Plex Sans';
        font-style: normal;
        font-weight: 100 700;
        font-display: swap;
        src:
          local('IBM Plex Sans Var'),
          local('IBMPlexSansVar'),
          local('IBM Plex Sans Var Regular'),
          local('IBMPlexSansVar-Regular'),
          url('./IBMPlexSansVar-Roman.woff2') format('woff2');
      }

      :global(*) {
        box-sizing: border-box;
      }

      :global([hidden]) {
        display: none !important;
      }

      :global(html),
      :global(body) {
        margin: 0;
        padding: 0;
        background: transparent;
      }

      /* Hidden until the page has sent its styles, so the fields never show
         in anything but the app's own. */
      :global(html:not(.styled) body) {
        visibility: hidden;
      }

      /* The content is moved by part of a pixel, which must not scroll it. */
      :global(html) {
        overflow: hidden;
      }

      :global(body) {
        position: relative;
        overflow: hidden;
      }

      :global(input) {
        font: inherit;
        letter-spacing: inherit;
      }

      :global(input:focus:not(:focus-visible)) {
        outline-color: transparent;
      }

      :global(svg) {
        display: inline-block;
        max-width: 100%;
      }

      .credential-fields {
        display: flex;
        flex-direction: column;
        margin: 0;
      }

      /* The profile settings modal's change-password form. */
      .layout-settings {
        display: grid;
        gap: var(--settings-modal-gap);
      }

      .layout-settings.narrow .password-settings-field {
        grid-template-columns: 1fr;
        gap: var(--boxel-sp-xs);
      }

      /* The settings modal's and the change-email modal's fields show an
         invalid input by its border alone. */
      .profile-field :deep(.invalid) {
        box-shadow: none;
      }
    </style>
  </template>
}

function concatLayout(layout: string) {
  return `layout-${layout}`;
}
