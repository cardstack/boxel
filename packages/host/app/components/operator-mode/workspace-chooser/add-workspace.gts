import { hash } from '@ember/helper';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { tracked } from '@glimmer/tracking';

import { task } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';
import ToElsewhere from 'ember-elsewhere/components/to-elsewhere';
import focusTrap from 'ember-focus-trap/modifiers/focus-trap';

import onKeyMod from 'ember-keyboard/modifiers/on-key';

import {
  BoxelInput,
  Button,
  FieldContainer,
  LoadingIndicator,
} from '@cardstack/boxel-ui/components';
import { IconPlus } from '@cardstack/boxel-ui/icons';

import type MatrixService from '@cardstack/host/services/matrix-service';

import { generateRandomWorkspaceName } from '../../../lib/random-name';
import {
  getRandomBackgroundURL,
  iconURLFor,
  cleanseString,
} from '../../../lib/utils';

import ModalContainer from '../../modal-container';

import ItemContainer from './item-container';

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

class AddWorkspaceModal extends Component<AddWorkspaceModalSignature> {
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

interface Signature {
  Element: HTMLButtonElement;
}

export default class AddWorkspace extends Component<Signature> {
  @service private declare matrixService: MatrixService;
  @tracked private isModalOpen: boolean = false;
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
      this.endpoint = cleanseString(value);
    }
  };
  private closeModal = () => {
    this.isModalOpen = false;
  };
  private initializeSuggestedName() {
    this.hasUserEditedEndpoint = false;
    this.setDisplayName(generateRandomWorkspaceName());
  }
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
  private setIsModalOpen = (value: boolean) => {
    this.isModalOpen = value;
    if (value) {
      this.error = null;
      this.initializeSuggestedName();
    }
  };
  <template>
    <ItemContainer
      {{on 'click' (fn this.setIsModalOpen true)}}
      class='container'
      data-test-add-workspace
    >
      <div class='content'>
        <IconPlus width='40px' height='40px' role='presentation' class='icon' />
        <br />
        New workspace
      </div>
    </ItemContainer>
    {{#if this.isModalOpen}}
      <ToElsewhere
        @named='modal-elsewhere'
        @send={{component
          AddWorkspaceModal
          displayName=this.displayName
          endpoint=this.endpoint
          setDisplayName=this.setDisplayName
          setEndpoint=this.setEndpoint
          createWorkspaceTask=this.createWorkspaceTask
          error=this.error
          onClose=(fn this.setIsModalOpen false)
        }}
        }}
      />
    {{/if}}
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
    </style>
  </template>
}
