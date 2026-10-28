// An error as the app's operator mode shows one (the host's ErrorDisplay): a
// warning header, a general message, and Show Details revealing the full
// error. boxel-ui and the host can't ship on the secure origin (ADR 008 §1.3),
// so its look is brought here. It leaves out what needs the app: copying to
// the clipboard, sending the error to the AI assistant, and code mode.
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { trackedObject } from '@ember/reactive/collections';

import Button from './button.gts';
import DropdownArrowDown from './icons/dropdown-arrow-down.gts';
import DropdownArrowUp from './icons/dropdown-arrow-up.gts';
import Warning from './icons/warning.gts';

export interface ErrorDetail {
  label: string;
  value: string;
}

interface Signature {
  Args: {
    headerText: string;
    message: string;
    details: ErrorDetail[];
  };
  Element: HTMLElement;
}

export default class ErrorDisplay extends Component<Signature> {
  <template>
    <div
      class='error-display'
      role='alert'
      data-test-error-display
      ...attributes
    >
      <div class='error-header'>
        <div class='error-type' data-test-error-type>
          <Warning class='error-icon' aria-hidden='true' />
          <span>{{@headerText}}</span>
        </div>
      </div>

      <div class='error-message' data-test-error-message>
        {{@message}}
      </div>

      {{#if @details.length}}
        <div class='error-actions'>
          <Button
            class='toggle-details-button'
            @kind='text-only'
            @size='extra-small'
            aria-expanded={{if this.state.showDetails 'true' 'false'}}
            data-test-toggle-details
            {{on 'click' this.toggleDetails}}
          >
            {{if this.state.showDetails 'Hide Details' 'Show Details'}}
            {{#if this.state.showDetails}}
              <DropdownArrowUp width='12px' height='12px' aria-hidden='true' />
            {{else}}
              <DropdownArrowDown
                width='12px'
                height='12px'
                aria-hidden='true'
              />
            {{/if}}
          </Button>
        </div>
      {{/if}}

      {{#if this.state.showDetails}}
        <dl class='error-details' data-test-error-details>
          {{#each @details as |detail|}}
            <div class='detail-item'>
              <dt class='detail-title'>{{detail.label}}</dt>
              <dd
                class='detail-contents'
                data-test-error-detail={{detail.label}}
              >{{detail.value}}</dd>
            </div>
          {{/each}}
        </dl>
      {{/if}}
    </div>

    <style scoped>
      .error-display {
        background: var(--boxel-warning-200);
        border-radius: var(--boxel-border-radius-lg);
        padding-bottom: var(--boxel-sp-xs);
        color: var(--boxel-dark);
        width: 100%;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }

      .error-header {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp) var(--boxel-sp) 0 var(--boxel-sp);
      }

      .error-type {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        font-weight: 600;
        text-transform: uppercase;
      }

      .error-icon {
        width: 20px;
        height: 20px;
        flex-shrink: 0;
      }

      .error-message {
        font-size: var(--boxel-font-size-sm);
        padding: 0 var(--boxel-sp) 0
          calc(var(--boxel-sp) + 20px + var(--boxel-sp-xs));
      }

      .error-actions {
        display: flex;
        justify-content: flex-end;
        align-items: center;
        padding: 0 var(--boxel-sp);
      }

      .toggle-details-button {
        padding: 0;
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xxs);
        font-weight: 400;
        border: none;
      }

      .toggle-details-button:hover {
        background-color: transparent;
      }

      /* Inset in the warning box, so the box frames the details on every side
         wherever it sits, light page or dark. */
      .error-details {
        background: var(--boxel-light);
        border-radius: var(--boxel-border-radius);
        padding: var(--boxel-sp);
        margin: 0 var(--boxel-sp-xs);
      }

      .detail-item {
        margin-bottom: var(--boxel-sp);
      }

      .detail-item:last-child {
        margin-bottom: 0;
      }

      .detail-title {
        font-weight: 600;
        margin-bottom: var(--boxel-sp-xxs);
      }

      .detail-contents {
        margin: 0;
        overflow-wrap: anywhere;
      }
    </style>
  </template>

  private state = trackedObject({ showDetails: false });

  private toggleDetails = () => {
    this.state.showDetails = !this.state.showDetails;
  };
}
