import { on } from '@ember/modifier';
import { action } from '@ember/object';

import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import window from 'ember-window-mock';

import { IconButton } from '@cardstack/boxel-ui/components';
import { IconX, Warning } from '@cardstack/boxel-ui/icons';

export const FALLBACK_BANNER_DISMISSED_KEY = 'FallbackBannerDismissed';

interface Signature {
  Element: HTMLDivElement;
}

export default class FallbackBanner extends Component<Signature> {
  @tracked private dismissed =
    window.sessionStorage.getItem(FALLBACK_BANNER_DISMISSED_KEY) === 'true';

  @action private dismiss() {
    window.sessionStorage.setItem(FALLBACK_BANNER_DISMISSED_KEY, 'true');
    this.dismissed = true;
  }

  <template>
    {{#unless this.dismissed}}
      <div
        class='fallback-banner'
        role='status'
        data-test-fallback-banner
        ...attributes
      >
        <Warning class='icon' />
        <p class='message'>
          Custom system card couldn't be loaded — using built-in defaults. Some
          models may have reduced capabilities.
        </p>
        <IconButton
          @icon={{IconX}}
          @width='12'
          @height='12'
          class='dismiss'
          aria-label='Dismiss fallback banner'
          data-test-fallback-banner-dismiss
          {{on 'click' this.dismiss}}
        />
      </div>
    {{/unless}}
    <style scoped>
      .fallback-banner {
        display: grid;
        grid-template-columns: 20px 1fr 20px;
        align-items: start;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        background-color: var(--boxel-warning-200);
        color: var(--boxel-dark);
        font: 500 var(--boxel-font-xs);
        letter-spacing: var(--boxel-lsp-sm);
      }
      .icon {
        width: 20px;
        height: 20px;
        margin-top: 1px;
      }
      .message {
        margin: 0;
        align-self: center;
      }
      .dismiss {
        --icon-color: var(--boxel-dark);
        width: 20px;
        height: 20px;
        min-width: 20px;
        min-height: 20px;
        padding: 4px;
        border: none;
        background: none;
        border-radius: var(--boxel-border-radius-xs);
      }
      .dismiss:hover {
        background-color: rgba(0, 0, 0, 0.08);
      }
    </style>
  </template>
}
