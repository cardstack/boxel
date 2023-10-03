import { service } from '@ember/service';
import Component from '@glimmer/component';

import { BoxelInput } from '@cardstack/boxel-ui';
import { svgJar } from '@cardstack/boxel-ui/helpers/svg-jar';
import { and, bool, not } from '@cardstack/boxel-ui/helpers/truth-helpers';
import { on } from '@ember/modifier';

import URLBarResource, {
  urlBarResource,
} from '@cardstack/host/resources/url-bar';

import type OperatorModeStateService from '../../services/operator-mode-state-service';
import type CardService from '../../services/card-service';
import RealmInfoProvider from '@cardstack/host/components/operator-mode/realm-info-provider';

interface Signature {
  Element: HTMLElement;
  Args: {
    // TODO consider refactoring so that the upstream component (code-mode.gts)
    // doesn't manage the error state, and rather that moves into this component
    // as we have 4 params related to error state management that are passed into
    // this component. This might be a good code-mode.gts refactoring effort...
    loadFileError: string | null; // upstream error message
    userHasDismissedError: boolean; // user driven state that indicates if we should show error message
    resetLoadFileError: () => void; // callback to reset upstream error state -- perform on keypress
    dismissURLError: () => void; // callback allow user to dismiss the error message
    realmURL: string;
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
        <RealmInfoProvider @realmURL={{@realmURL}}>
          <:ready as |realmInfo|>
            <div class='realm-icon'>
              <img src={{realmInfo.iconURL}} alt='realm-icon' />
            </div>
            <span>in {{realmInfo.name}}</span>
          </:ready>
          <:error>
            <div class='realm-icon'>
              {{svgJar 'icon-circle' width='22px' height='22px'}}
            </div>
            <span>in Unknown Workspace</span>
          </:error>
        </RealmInfoProvider>
      </div>
      <div class='input'>
        {{svgJar 'icon-globe' width='22px' height='22px'}}
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
            {{svgJar 'warning' width='20px' height='20px'}}
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
      .realm-icon {
        display: flex;
        align-items: center;
        background-color: var(--boxel-light);
        background-image: var(--card-url-bar-realm-icon);

        border: 1px solid var(--boxel-light);
        border-radius: 4px;

        --icon-color: var(--boxel-light);
      }
      .realm-icon img {
        width: 20px;
        height: 20px;
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
        font-weight: bold;
        color: var(--boxel-highlight);
        border: none;
        background-color: transparent;
      }
    </style>
  </template>

  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare cardService: CardService;

  private urlBar: URLBarResource = urlBarResource(this, () => ({
    getValue: () => this.codePath,
    setValue: (url: string) => {
      this.operatorModeStateService.updateCodePath(new URL(url));
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
