import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { BoxelInput } from '@cardstack/boxel-ui';
import { svgJar } from '@cardstack/boxel-ui/helpers/svg-jar';
import { action } from '@ember/object';
import { service } from '@ember/service';
import { trackedFunction } from 'ember-resources/util/function';
import type { CardDef } from 'https://cardstack.com/base/card-api';
import type CardService from '../../services/card-service';
import { cardTypeDisplayName } from '@cardstack/runtime-common';
import { or, not } from '@cardstack/boxel-ui/helpers/truth-helpers';

interface Signature {
  Element: HTMLElement;
  Args: {
    url: URL;
    onURLChange: (url: URL) => void;
    card: CardDef | null;
    isInvalid: boolean;
    errorMessage: string | null;
  };
}

export default class CardURLBar extends Component<Signature> {
  <template>
    <div
      id='card-url-bar'
      class={{this.cssStyle}}
      data-test-card-url-bar
      ...attributes
    >
      {{#if (not this.isFocused)}}
        <div class='realm-info' data-test-card-url-bar-realm-info>
          <img src={{this.realmIcon}} />
          <span>in
            {{if this.realmName this.realmName 'Unknown Workspace'}}</span>
        </div>
      {{/if}}
      <div class='input'>
        {{svgJar 'icon-globe' width='22px' height='22px'}}
        <BoxelInput
          class='url-input'
          @value={{if
            (or this.isFocused (not this.cardDisplayName))
            this.url
            this.cardDisplayName
          }}
          @onInput={{this.onInput}}
          @onKeyPress={{this.onKeyPress}}
          @onFocus={{this.toggleFocus}}
          @onBlur={{this.toggleFocus}}
          data-test-card-url-bar-input
        />
      </div>
      {{#if this.showErrorMessage}}
        <div class='error-message' data-test-card-url-bar-error>
          <span>{{if this.isInvalid this.errorMessage @errorMessage}}</span>
        </div>
      {{/if}}
    </div>
    <style>
      .card-url-bar {
        display: flex;
        align-items: center;

        background: var(--boxel-purple-700);
        border-radius: var(--boxel-border-radius-xl);
        padding: var(--boxel-sp-xs) 0 var(--boxel-sp-xs) var(--boxel-sp-sm);

        width: 100%;
        position: relative;
      }
      .focused {
        outline: 2px solid var(--boxel-teal);
      }
      .invalid {
        outline: 2px solid red;
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

  @service declare cardService: CardService;
  @tracked isFocused: boolean = false;
  @tracked url: string = this.args.url.toString();
  @tracked isInvalid: boolean = false;
  @tracked errorMessage: string | null = null;

  get realmIcon() {
    return this.fetchRealmInfo.value?.iconURL;
  }

  get realmName() {
    return this.fetchRealmInfo.value?.name;
  }

  get cardDisplayName() {
    if (!this.args.card) return;
    return cardTypeDisplayName(this.args.card);
  }

  get showErrorMessage() {
    return (
      (this.args.isInvalid && this.args.errorMessage) ||
      (this.isInvalid && this.errorMessage)
    );
  }

  get cssStyle() {
    if (this.args.isInvalid) {
      return 'card-url-bar invalid';
    } else if (this.isFocused) {
      return 'card-url-bar focused';
    } else {
      return 'card-url-bar';
    }
  }

  fetchCard = trackedFunction(
    this,
    async () => await this.cardService.loadModel(this.args.url),
  );

  fetchRealmInfo = trackedFunction(this, async () => {
    if (!this.args.card) return;
    return this.cardService.getRealmInfo(this.args.card);
  });

  @action
  onInput(url: string) {
    this.url = url;
  }

  @action
  onKeyPress(event: KeyboardEvent) {
    try {
      if (event.key === 'Enter' || event.keyCode === 13) {
        this.args.onURLChange(new URL(this.url));
        this.isInvalid = false;
        this.errorMessage = null;
      }
    } catch (e) {
      this.isInvalid = true;
      this.errorMessage = 'Not a valid Card URL';
    }
  }

  @action
  toggleFocus() {
    this.isFocused = !this.isFocused;
  }
}
