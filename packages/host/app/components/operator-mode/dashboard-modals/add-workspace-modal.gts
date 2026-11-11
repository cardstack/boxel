import { hash } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';

import { ignoredByPasswordManagers } from '@cardstack/pretui/password-managers';
import perform from 'ember-concurrency/helpers/perform';
import focusTrap from 'ember-focus-trap/modifiers/focus-trap';

import onKeyMod from 'ember-keyboard/modifiers/on-key';

import {
  BoxelInput,
  Button,
  FieldContainer,
  LoadingIndicator,
} from '@cardstack/boxel-ui/components';

import ModalContainer from '@cardstack/host/components/modal-container';

import type { task } from 'ember-concurrency';

interface AddWorkspaceModalSignature {
  Element: HTMLDivElement;
  Args: {
    displayName: string;
    endpoint: string;
    setDisplayName: (value: string) => void;
    setEndpoint: (value: string) => void;
    createWorkspaceTask?: ReturnType<typeof task>;
    error: string | null;
    onClose: () => void;
  };
}

export default class AddWorkspaceModal extends Component<AddWorkspaceModalSignature> {
  private get isCreateWorkspaceButtonDisabled() {
    return !this.args.endpoint || !this.args.displayName;
  }
  <template>
    <ModalContainer
      @title='Add Workspace'
      @size='medium'
      @isOpen={{true}}
      @onClose={{@onClose}}
      @cardContainerClass='create-workspace'
      class='create-workspace-modal'
      {{focusTrap
        isActive=@createWorkspaceTask.isIdle
        focusTrapOptions=(hash
          initialFocus='.create-workspace-modal input' allowOutsideClick=true
        )
      }}
      data-test-create-workspace-modal
    >
      <:content>
        {{#if @createWorkspaceTask.isRunning}}
          <div class='spinner-container'>
            <div class='spinner-inner-container'>
              <LoadingIndicator class='spinner' />
              <div>
                Creating workspace...
              </div>
            </div>
          </div>
        {{else}}
          <FieldContainer @label='Display Name' @tag='label' class='field'>
            <BoxelInput
              data-test-display-name-field
              placeholder='Workspace Display Name'
              @value={{@displayName}}
              @onInput={{@setDisplayName}}
              @helperText='This is how your workspace will appear in the UI.'
              {{ignoredByPasswordManagers}}
            />
          </FieldContainer>
          <FieldContainer
            @label='Workspace Endpoint'
            @tag='label'
            class='field'
          >
            <BoxelInput
              data-test-endpoint-field
              placeholder='Workspace Endpoint'
              @value={{@endpoint}}
              @onInput={{@setEndpoint}}
              @helperText='The endpoint is the unique identifier for your workspace. Use letters, numbers, and hyphens only.'
              {{ignoredByPasswordManagers}}
            />
          </FieldContainer>
        {{/if}}
        {{#if @error}}
          <div class='error-message' data-test-error-message>
            {{@error}}
          </div>
        {{/if}}
      </:content>
      <:footer>
        {{#unless @createWorkspaceTask.isRunning}}
          <div class='footer-buttons'>
            <Button
              {{on 'click' @onClose}}
              {{onKeyMod 'Escape'}}
              @size='tall'
              data-test-cancel-create-workspace
            >
              Cancel
            </Button>
            <Button
              @kind='primary'
              @size='tall'
              @loading={{@createWorkspaceTask.isRunning}}
              @disabled={{this.isCreateWorkspaceButtonDisabled}}
              {{on 'click' (perform @createWorkspaceTask)}}
              {{onKeyMod 'Enter'}}
              data-test-create-workspace-submit
            >
              Create
            </Button>
          </div>
        {{/unless}}
      </:footer>
    </ModalContainer>
    <style scoped>
      .create-workspace-modal > :deep(.boxel-modal__inner) {
        display: flex;
      }
      :deep(.create-workspace) {
        height: 28rem;
      }
      .boxel-field + .boxel-field {
        margin-top: var(--boxel-sp);
      }
      .field {
        --boxel-field-label-size: 8rem;
        padding-right: 0;
      }
      .footer-buttons {
        display: flex;
        margin-left: auto;
        gap: var(--boxel-sp-xxs);
      }
      .error-message {
        color: var(--boxel-error-100);
        margin-top: var(--boxel-sp-lg);
      }
      .spinner-container {
        align-items: center;
        display: flex;
        height: 12rem;
        justify-content: center;
      }
      .spinner-inner-container {
        align-items: center;
        display: flex;
        flex-direction: column;
        gap: 1rem;
        justify-content: center;
        text-align: center;
      }
      .spinner {
        --boxel-loading-indicator-size: 2.5rem;
      }
    </style>
  </template>
}
