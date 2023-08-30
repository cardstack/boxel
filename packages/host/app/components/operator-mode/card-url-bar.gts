import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { BoxelInput } from '@cardstack/boxel-ui';
import { svgJar } from '@cardstack/boxel-ui/helpers/svg-jar';
import { action } from '@ember/object';
import { service } from '@ember/service';
import { type RealmInfo } from '@cardstack/runtime-common';
import type CardService from '../../services/card-service';
import type OperatorModeStateService from '../../services/operator-mode-state-service';

interface Signature {
  Element: HTMLElement;
  Args: {
    onEnterPressed: (url: URL) => void;
    loadFileError: string | null;
    resetLoadFileError: () => void;
    realmInfo: RealmInfo | null;
  };
}

export default class CardURLBar extends Component<Signature> {
  <template>
    <div
      id='card-url-bar'
      class={{this.cssClasses}}
      data-test-card-url-bar
      ...attributes
    >
      <div class='realm-info' data-test-card-url-bar-realm-info>
        <img src={{this.realmIcon}} alt='realm-icon' />
        <span>in
          {{if this.realmName this.realmName 'Unknown Workspace'}}</span>
      </div>
      <div class='input'>
        {{svgJar 'icon-globe' width='22px' height='22px'}}
        <BoxelInput
          class='url-input'
          @value={{this.url}}
          @onInput={{this.onInput}}
          @onKeyPress={{this.onKeyPress}}
          @onFocus={{this.toggleFocus}}
          @onBlur={{this.toggleFocus}}
          data-test-card-url-bar-input
        />
      </div>
      {{#if this.showErrorMessage}}
        <div class='error-message' data-test-card-url-bar-error>
          <span>{{this.errorMessage}}</span>
        </div>
      {{/if}}
    </div>
    <style>
      :global(:root) {
        --card-url-bar-width: 100%;
      }
      .card-url-bar {
        display: flex;
        align-items: center;

        background-color: var(--boxel-dark);
        border-radius: var(--boxel-border-radius-xl);
        padding: var(--boxel-sp-xs) 0 var(--boxel-sp-xs) var(--boxel-sp-sm);

        width: var(--card-url-bar-width);
      }
      .focused {
        outline: 2px solid var(--boxel-highlight);
      }
      .error {
        outline: 2px solid var(--boxel-error-200);
      }
      .realm-info {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);

        width: max-content;
        color: var(--boxel-light);
        border-right: 2px solid var(--boxel-purple-300);
        padding-right: var(--boxel-sp-xs);
        margin-right: var(--boxel-sp-xs);

        white-space: nowrap;
      }
      .realm-info img {
        width: 22px;
      }
      .input {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        width: 100%;

        --icon-color: var(--boxel-cyan);
      }
      .error .input {
        --icon-color: var(--boxel-error-200);
      }
      .url-input {
        background: none;
        border: none;
        border-radius: 0;
        outline: none;
        padding: 0;
        min-height: 0;

        color: var(--boxel-light);
      }
      .error-message {
        position: absolute;
        bottom: calc(calc(var(--boxel-sp-xs) * 2) * -1);
        color: red;
      }
    </style>
  </template>

  @service declare operatorModeStateService: OperatorModeStateService;
  @service declare cardService: CardService;
  @tracked url: string | null = null;
  @tracked isFocused = false;
  @tracked isInvalidURL = false;

  constructor(args: any, owner: any) {
    super(args, owner);

    this.url = this.operatorModeStateService.state.codePath
      ? this.operatorModeStateService.state.codePath.toString()
      : null;
  }

  get realmIcon() {
    return this.args.realmInfo?.iconURL;
  }

  get realmName() {
    return this.args.realmInfo?.name;
  }

  get showErrorMessage() {
    return this.isInvalidURL || this.args.loadFileError;
  }

  get errorMessage() {
    if (this.isInvalidURL) {
      return 'Not a valid URL';
    } else {
      return this.args.loadFileError;
    }
  }

  get cssClasses() {
    if (this.showErrorMessage) {
      return 'card-url-bar error';
    } else if (this.isFocused) {
      return 'card-url-bar focused';
    } else {
      return 'card-url-bar';
    }
  }

  @action
  onInput(url: string) {
    this.url = url;
    this.isInvalidURL = false;
    this.args.resetLoadFileError();
  }

  @action
  onKeyPress(event: KeyboardEvent) {
    if (event.key !== 'Enter' || !this.url) {
      return;
    }

    let url;
    try {
      url = new URL(this.url);
    } catch (e) {
      this.isInvalidURL = true;
    }

    if (url) {
      this.operatorModeStateService.updateCodePath(url);
      this.args.onEnterPressed(url);
    }
  }

  @action
  toggleFocus() {
    this.isFocused = !this.isFocused;
  }
}
