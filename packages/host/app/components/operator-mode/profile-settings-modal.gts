import { on } from '@ember/modifier';
import { action } from '@ember/object';

import { inject as service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';

import perform from 'ember-concurrency/helpers/perform';

import {
  BoxelButton,
  BoxelInput,
  FieldContainer,
} from '@cardstack/boxel-ui/components';

import { not, and } from '@cardstack/boxel-ui/helpers';

import ModalContainer from '@cardstack/host/components/modal-container';

import { ProfileInfo } from '@cardstack/host/components/operator-mode/profile-info-popover';
import config from '@cardstack/host/config/environment';
import MatrixService from '@cardstack/host/services/matrix-service';

interface Signature {
  Args: {
    toggleProfileSettings: () => void;
  };
  Element: HTMLElement;
}

export default class ProfileSettingsModal extends Component<Signature> {
  @service private declare matrixService: MatrixService;

  @tracked private displayName: string | undefined = undefined;
  @tracked private saveSuccessIndicatorShown = false;
  @tracked private error: Error | undefined = undefined;
  @tracked private showDisplayNameValidation = false;

  @action private setDisplayName(name: string) {
    this.showDisplayNameValidation = true; // We don't want to show validation error until the user has interacted with the field, i.e. when display name is blank and user opens settings modal
    this.displayName = name;
  }

  private saveTask = restartableTask(async () => {
    await this.matrixService.profile.loaded; // Prevent saving before profile is loaded

    this.error = undefined;

    try {
      await Promise.all([
        this.matrixService.setDisplayName(this.displayName || ''),
        new Promise((resolve) =>
          setTimeout(resolve, config.minSaveTaskDurationMs),
        ),
      ]); // Add a bit of artificial delay if needed, to make the save button feel more responsive
    } catch (e) {
      this.error = new Error('Failed to save profile. Please try again.');
    }

    this.matrixService.reloadProfile(); // To get the updated display name in templates
    this.afterSaveTask.perform();
  });

  private afterSaveTask = restartableTask(async () => {
    this.saveSuccessIndicatorShown = true;
    await new Promise((resolve) => setTimeout(resolve, 2000));
    this.saveSuccessIndicatorShown = false;
  });

  private setInitialValues = restartableTask(async () => {
    await this.matrixService.profile.loaded;
    this.displayName = this.matrixService.profile.displayName;
  });

  @action private onSubmit(event: Event) {
    event.preventDefault();
    this.saveTask.perform();
  }

  private get saveButtonText() {
    if (this.saveSuccessIndicatorShown) return 'Saved!';
    return this.saveTask.isRunning ? 'Saving…' : 'Save';
  }

  private get isDisplayNameValid() {
    return this.displayName !== undefined && this.displayName.length > 0;
  }

  private get isSaveButtonDisabled() {
    return (
      this.saveTask.isRunning ||
      !this.isDisplayNameValid ||
      this.displayName === this.matrixService.profile.displayName
    );
  }

  constructor(owner: unknown, args: any) {
    super(owner, args);
    this.setInitialValues.perform();
  }

  <template>
    <style>
      .buttons {
        margin-left: auto;
        margin-top: auto;
        margin-bottom: auto;
      }

      .buttons > :not(:first-child) {
        margin-left: var(--boxel-sp-xs);
      }

      .profile-settings-modal {
        height: 70vh;
      }

      .error-message {
        color: var(--boxel-error-100);
        margin-top: var(--boxel-sp-lg);
      }
    </style>

    <ModalContainer
      @onClose={{@toggleProfileSettings}}
      @title='Settings'
      @size='large'
      @centered={{true}}
      @isOpen={{true}}
      class='profile-settings-modal'
      data-test-settings-modal
    >
      <:sidebar>
        <ProfileInfo />
      </:sidebar>
      <:content>
        <form {{on 'submit' this.onSubmit}}>
          <FieldContainer
            @label='Name'
            @tag='label'
            class=''
            @vertical={{false}}
          >
            <BoxelInput
              data-test-display-name-field
              @value={{this.matrixService.profile.displayName}}
              @onInput={{this.setDisplayName}}
              @valid={{this.isDisplayNameValid}}
              @errorMessage={{if
                (not this.isDisplayNameValid)
                'Name is required'
              }}
              @state={{if
                (and
                  this.showDisplayNameValidation (not this.isDisplayNameValid)
                )
                'invalid'
              }}
            />
          </FieldContainer>
        </form>

        {{#if this.error}}
          <div class='error-message' data-test-profile-save-error>
            {{this.error.message}}
          </div>
        {{/if}}
      </:content>
      <:footer>
        <div class='buttons'>
          <BoxelButton
            data-test-confirm-cancel-button
            @size='tall'
            @kind='secondary-light'
            {{on 'click' @toggleProfileSettings}}
          >
            Cancel
          </BoxelButton>

          <BoxelButton
            @kind='primary'
            @size='tall'
            @disabled={{this.isSaveButtonDisabled}}
            class='save-button'
            {{on 'click' (perform this.saveTask)}}
            data-test-profile-settings-save-button
          >
            {{this.saveButtonText}}
          </BoxelButton>
        </div>
      </:footer>
    </ModalContainer>
  </template>
}
