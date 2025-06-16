import { on } from '@ember/modifier';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { BoxelInput, RealmIcon } from '@cardstack/boxel-ui/components';

import { and, bool, not } from '@cardstack/boxel-ui/helpers';

import { IconGlobe, Warning as IconWarning } from '@cardstack/boxel-ui/icons';

import URLBarResource, {
  urlBarResource,
} from '@cardstack/host/resources/url-bar';

import type RealmService from '@cardstack/host/services/realm';

import type CardService from '../../services/card-service';
import type OperatorModeStateService from '../../services/operator-mode-state-service';

interface Signature {
  Element: HTMLElement;
  Args: {
    // TODO consider refactoring so that the upstream component (code-submode.gts)
    // doesn't manage the error state, and rather that moves into this component
    // as we have 4 params related to error state management that are passed into
    // this component. This might be a good code-mode.gts refactoring effort...
    loadFileError: string | null; // upstream error message
    userHasDismissedError: boolean; // user driven state that indicates if we should show error message
    resetLoadFileError: () => void; // callback to reset upstream error state -- perform on keypress
    dismissURLError: () => void; // callback allow user to dismiss the error message
    realmURL: URL;
  };
}

export default class CardURLBar extends Component<Signature> {
  <template>
    <div
      id='card-url-bar'
      class='card-url-bar {{if this.urlBar.isFocused "focused"}}'
      data-test-card-url-bar
      ...attributes
    >
      <div class='realm-info' data-test-card-url-bar-realm-info>
        {{#let (this.realm.info @realmURL.href) as |realmInfo|}}
          <RealmIcon
            class='url-realm-icon'
            @realmInfo={{realmInfo}}
            @canAnimate={{true}}
          />
          <span>in {{realmInfo.name}}</span>
        {{/let}}
      </div>
      <div class='input'>
        <IconGlobe width='18px' height='18px' />
        <BoxelInput
          class='url-input'
          @value={{this.urlBar.url}}
          @onInput={{this.urlBar.onInput}}
          @onKeyPress={{this.urlBar.onKeyPress}}
          @onBlur={{this.urlBar.onBlur}}
          @onFocus={{this.urlBar.onFocus}}
          data-test-card-url-bar-input
        />
      </div>
      {{#if (and (not @userHasDismissedError) (bool this.urlBar.errorMessage))}}
        <div class='error-message' data-test-card-url-bar-error>
          <span class='warning'>
            <IconWarning width='20px' height='20px' />
          </span>
          <span class='message'>{{this.urlBar.errorMessage}}</span>
          <button
            data-test-dismiss-url-error-button
            class='dismiss'
            {{on 'click' @dismissURLError}}
          >Dismiss</button>
        </div>
      {{/if}}

    </div>
    <style scoped>
      :global(:root) {
        --card-url-bar-width: 100%;
        --card-url-bar-height: var(--boxel-form-control-height);
      }
      .card-url-bar {
        position: relative;
        display: flex;
        align-items: center;

        background-color: var(--boxel-dark);
        border-radius: var(--boxel-border-radius);
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);

        width: var(--card-url-bar-width);
        height: var(--card-url-bar-height);
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
        gap: var(--boxel-sp-xxs);

        width: max-content;
        color: var(--boxel-light);
        border-right: 2px solid var(--boxel-purple-300);
        padding-right: var(--boxel-sp-xs);
        margin-right: var(--boxel-sp-xs);

        white-space: nowrap;
      }
      .url-realm-icon {
        --boxel-realm-icon-background-color: currentColor;
        --boxel-realm-icon-border-color: currentColor;
      }
      .input {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        width: 100%;

        --icon-color: var(--boxel-highlight);
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
        text-overflow: ellipsis;

        color: var(--boxel-light);
      }
      .error-message {
        position: absolute;
        display: flex;
        overflow: hidden;
        align-items: center;
        top: var(--submode-switcher-height);
        left: 0;
        background-color: var(--boxel-light);
        width: 100%;
        height: var(--submode-switcher-height);
        border-radius: var(--boxel-border-radius);
        box-shadow: var(--boxel-deep-box-shadow);
        font: var(--boxel-font-sm);
        font-weight: 500;
        z-index: 1;
      }
      .warning {
        display: flex;
        align-items: center;
        justify-content: center;
        background-color: var(--boxel-yellow);
        width: 40px;
        height: 100%;
      }
      .message {
        margin-left: var(--boxel-sp);
      }

      .dismiss {
        position: absolute;
        right: 0;
        margin-right: var(--boxel-sp-xxs);
        font-weight: 600;
        color: var(--boxel-highlight);
        border: none;
        background-color: transparent;
      }
    </style>
  </template>

  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare cardService: CardService;
  @service private declare realm: RealmService;

  private urlBar: URLBarResource = urlBarResource(this, () => ({
    getValue: () => (this.codePath ? decodeURI(this.codePath) : ''),
    setValue: async (url: string) => {
      await this.operatorModeStateService.updateCodePath(new URL(url));
    },
    setValueError: this.args.loadFileError,
    resetValueError: this.args.resetLoadFileError,
  }));

  private get codePath() {
    return this.operatorModeStateService.state.codePath
      ? this.operatorModeStateService.state.codePath.toString()
      : null;
  }
}
