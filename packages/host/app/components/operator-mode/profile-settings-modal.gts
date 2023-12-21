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
  @service declare matrixService: MatrixService;

  @tracked private displayName: string | undefined = undefined;
  @tracked private saveSuccessIndicatorShown = false;

  @action setDisplayName(name: string) {
    this.displayName = name;
  }

  private saveTask = restartableTask(async () => {
    await this.matrixService.profile.loaded; // Prevent saving before profile is loaded
    let delayMs = config.environment === 'test' ? 1 : 1000;

    await Promise.all([
      this.matrixService.setDisplayName(this.displayName || ''),
      new Promise((resolve) => setTimeout(resolve, delayMs)),
    ]); // Add a bit of artificial delay if needed, to make the save button feel more responsive

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

  @action onSubmit(event: Event) {
    event.preventDefault();
    this.saveTask.perform();
  }

  get saveButtonText() {
    if (this.saveSuccessIndicatorShown) return 'Saved!';
    return this.saveTask.isRunning ? 'Saving…' : 'Save';
  }

  constructor(owner: unknown, args: any) {
    super(owner, args);
    this.setInitialValues.perform();
  }

  <template>
    <style>
      .save-button {
        margin-left: auto;
        margin-top: auto;
        margin-bottom: auto;
        margin-right: var(--boxel-sp-xxl);
      }

      .profile-settings-modal {
        height: 70vh;
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
            />
          </FieldContainer>
        </form>
      </:content>
      <:footer>
        <BoxelButton
          @kind='primary'
          @disabled={{this.saveTask.isRunning}}
          class='save-button'
          {{on 'click' (perform this.saveTask)}}
          data-test-profile-settings-save-button
        >
          {{this.saveButtonText}}
        </BoxelButton>
      </:footer>
    </ModalContainer>
  </template>
}
