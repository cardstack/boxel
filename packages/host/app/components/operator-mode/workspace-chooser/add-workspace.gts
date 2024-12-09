import { hash } from '@ember/helper';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { tracked } from '@glimmer/tracking';

import { task } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';
import focusTrap from 'ember-focus-trap/modifiers/focus-trap';

import onKeyMod from 'ember-keyboard/modifiers/on-key';

import {
  BoxelInput,
  Button,
  FieldContainer,
  LoadingIndicator,
} from '@cardstack/boxel-ui/components';
import { IconPlus } from '@cardstack/boxel-ui/icons';

import MatrixService from '@cardstack/host/services/matrix-service';

import {
  getRandomBackgroundURL,
  iconURLFor,
  cleanseString,
} from '../../../lib/utils';

import ModalContainer from '../../modal-container';

import ItemContainer from './item-container';

interface Signature {
  Element: HTMLButtonElement;
}

export default class AddWorkspace extends Component<Signature> {
  @service private declare matrixService: MatrixService;
  @tracked private isModalOpen = false;
  @tracked private endpoint = '';
  @tracked private displayName = '';
  @tracked private hasUserEditedEndpoint = false;
  @tracked private error: string | null = null;
  private setEndpoint = (value: string) => {
    this.hasUserEditedEndpoint = true;
    this.endpoint = value;
  };
  private setDisplayName = (value: string) => {
    this.displayName = value;
    // if the user starts typing in the endpoint field, then stop helping them
    if (!this.hasUserEditedEndpoint) {
      this.endpoint = cleanseString(value, '-');
    }
  };
  private closeModal = () => {
    this.isModalOpen = false;
  };
  private createWorkspaceTask = task(async () => {
    this.error = null;
    try {
      await this.matrixService.createPersonalRealmForUser({
        endpoint: this.endpoint,
        name: this.displayName,
        iconURL: iconURLFor(this.displayName),
        backgroundURL: getRandomBackgroundURL(),
      });
      this.closeModal();
    } catch (e: any) {
      this.error = e.message;
    }
  });
  private get isCreateWorkspaceButtonDisabled() {
    return !this.endpoint || !this.displayName;
  }
  <template>
    <ItemContainer
      {{on 'click' (fn (mut this.isModalOpen) true)}}
      class='container'
      data-test-add-workspace
    >
      <div class='content'>
        <IconPlus width='40px' height='40px' role='presentation' class='icon' />
        <br />
        New workspace
      </div>
    </ItemContainer>
    <ModalContainer
      @title='Add Workspace'
      @size='medium'
      @isOpen={{this.isModalOpen}}
      @onClose={{fn (mut this.isModalOpen) false}}
      @cardContainerClass='create-workspace'
      class='create-workspace-modal'
      {{focusTrap
        isActive=this.createWorkspaceTask.isIdle
        focusTrapOptions=(hash
          initialFocus='.create-workspace-modal input' allowOutsideClick=true
        )
      }}
      data-test-create-workspace-modal
    >
      <:content>
        {{#if this.isModalOpen}}
          {{#if this.createWorkspaceTask.isRunning}}
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
                @value={{this.displayName}}
                @onInput={{this.setDisplayName}}
                @helperText='This is how your workspace will appear in the UI.'
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
                @value={{this.endpoint}}
                @onInput={{this.setEndpoint}}
                @helperText='The endpoint is the unique identifier for your workspace. Use letters, numbers, and hyphens only.'
              />
            </FieldContainer>
          {{/if}}
        {{/if}}
        {{#if this.error}}
          <div class='error-message' data-test-error-message>
            {{this.error}}
          </div>
        {{/if}}
      </:content>
      <:footer>
        {{#if this.isModalOpen}}
          {{#unless this.createWorkspaceTask.isRunning}}
            <div class='footer-buttons'>
              <Button
                {{on 'click' this.closeModal}}
                {{onKeyMod 'Escape'}}
                @size='tall'
                data-test-cancel-create-workspace
              >
                Cancel
              </Button>
              <Button
                @kind='primary'
                @size='tall'
                @loading={{this.createWorkspaceTask.isRunning}}
                @disabled={{this.isCreateWorkspaceButtonDisabled}}
                {{on 'click' (perform this.createWorkspaceTask)}}
                {{onKeyMod 'Enter'}}
                data-test-create-workspace-submit
              >
                Create
              </Button>
            </div>
          {{/unless}}
        {{/if}}
      </:footer>
    </ModalContainer>
    <style scoped>
      .container {
        border-style: dashed;
        background: transparent;
        display: flex;
        justify-content: center;
        align-items: center;
      }
      .icon {
        --icon-color: var(--boxel-highlight);
      }
      .icon :deep(path) {
        stroke: none;
      }
      .content {
        color: var(--boxel-light);
        text-align: center;
      }
      .content .icon {
        color: var(--boxel-highlight);
      }

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
