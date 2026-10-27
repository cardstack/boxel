import { on } from '@ember/modifier';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { Button } from '@cardstack/boxel-ui/components';

import ModalContainer from '@cardstack/host/components/modal-container';

import type SecureWindowService from '@cardstack/host/services/secure-window';

// Offered when the browser blocks the secure window's popup: a button that
// opens the same window on the user's click, which a browser lets through.
export default class SecureWindowFallback extends Component {
  @service declare private secureWindow: SecureWindowService;

  private get blocked() {
    return this.secureWindow.blocked;
  }

  private get secureHost() {
    let url = this.blocked?.url;
    return url ? new URL(url).host : undefined;
  }

  <template>
    {{#if this.blocked}}
      <ModalContainer
        class='secure-window-fallback'
        @title='Open the secure window'
        @size='small'
        @centered={{true}}
        @onClose={{this.secureWindow.dismissBlocked}}
        data-test-secure-window-fallback
      >
        <:content>
          <p>
            Your browser blocked Boxel's secure window, where you enter and
            share your keys.
          </p>
          {{#if this.blocked.reason}}
            <p class='reason' data-test-secure-window-fallback-reason>
              <span class='reason-label'>Why it was opened:</span>
              {{this.blocked.reason}}
            </p>
          {{/if}}
          <p>
            Before you type a key into it, check that its address bar reads
            <strong data-test-secure-window-fallback-host>
              {{this.secureHost}}</strong>.
          </p>
        </:content>
        <:footer>
          <div class='footer-buttons'>
            <Button
              @size='tall'
              {{on 'click' this.secureWindow.dismissBlocked}}
              data-test-secure-window-fallback-cancel
            >
              Cancel
            </Button>
            <Button
              @kind='primary'
              @size='tall'
              {{on 'click' this.secureWindow.openBlocked}}
              data-test-secure-window-fallback-open
            >
              Open the secure window
            </Button>
          </div>
        </:footer>
      </ModalContainer>
    {{/if}}
    <style scoped>
      p {
        margin: 0 0 var(--boxel-sp-sm);
      }
      .reason-label {
        font-weight: 600;
      }
      .footer-buttons {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        width: 100%;
        justify-content: flex-end;
      }
    </style>
  </template>
}
