import Component from '@glimmer/component';
import { service } from '@ember/service';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import {
  Button,
  FieldContainer,
  BoxelInput,
  LoadingIndicator,
} from '@cardstack/boxel-ui';
import { dropTask, restartableTask } from 'ember-concurrency';
import { tracked } from '@glimmer/tracking';
import { not } from '@cardstack/host/helpers/truth-helpers';
import type MatrixService from '@cardstack/host/services/matrix-service';

export default class UserProfile extends Component {
  <template>
    <div class='wrapper'>
      <FieldContainer @label='User ID' @tag='label'>
        <div class='value' data-test-field-value='userId'>
          {{this.userId}}
        </div>
      </FieldContainer>

      <FieldContainer @label='Display Name' @tag='label'>
        {{#if this.isEditMode}}
          <BoxelInput
            data-test-displayName-field
            type='text'
            @value={{this.displayName}}
            @onInput={{this.setDisplayName}}
          />
        {{else}}
          <div class='value' data-test-field-value='displayName'>
            {{#if this.showLoading}}
              <LoadingIndicator />
            {{else}}
              {{this.displayName}}
            {{/if}}
          </div>
        {{/if}}
      </FieldContainer>
    </div>
    <div class='button-container'>
      {{#if this.isEditMode}}
        <Button
          class='user-button'
          data-test-profile-save-btn
          @disabled={{not this.displayName}}
          {{on 'click' this.save}}
        >Save</Button>
      {{else}}
        <Button
          class='user-button'
          data-test-profile-edit-btn
          {{on 'click' this.doEdit}}
        >Edit</Button>
        <Button
          class='user-button'
          data-test-logout-btn
          {{on 'click' this.logout}}
        >Logout</Button>
      {{/if}}
    </div>
    <style>
      .wrapper {
        padding: 0 var(--boxel-sp);
        margin: var(--boxel-sp) 0;
      }

      .wrapper label {
        margin-top: var(--boxel-sp-sm);
      }

      .button-container {
        display: flex;
        justify-content: flex-end;
        padding: 0 var(--boxel-sp) var(--boxel-sp);
      }
      .user-button {
        margin-left: var(--boxel-sp-xs);
      }
    </style>
  </template>

  @service private declare matrixService: MatrixService;
  @tracked private isEditMode = false;
  @tracked private displayName: string | undefined;

  constructor(owner: Owner, args: {}) {
    super(owner, args);
    if (!this.matrixService.isLoggedIn) {
      throw new Error(
        `cannot render UserProfile component when not logged into Matrix`,
      );
    }
    this.loadProfile.perform();
  }

  private get userId() {
    return this.matrixService.userId!; // This component only renders when we are logged in, so we'll always have a userId
  }

  private get showLoading() {
    return !this.displayName && this.loadProfile.isRunning;
  }

  @action
  private setDisplayName(displayName: string) {
    this.displayName = displayName;
  }

  @action
  private doEdit() {
    this.isEditMode = true;
  }

  @action
  private save() {
    this.doSave.perform();
  }

  @action
  private logout() {
    this.doLogout.perform();
  }

  private doLogout = dropTask(async () => {
    await this.matrixService.logout();
  });

  private loadProfile = restartableTask(async () => {
    let { displayname: displayName } =
      await this.matrixService.client.getProfileInfo(this.userId);
    this.displayName = displayName;
  });

  private doSave = restartableTask(async () => {
    if (!this.displayName) {
      throw new Error(
        `bug: should never get here, save button is disabled when there is no display name`,
      );
    }
    await this.matrixService.client.setDisplayName(this.displayName);
    this.isEditMode = false;
  });
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface UserProfile {
    'Matrix::UserProfile': typeof UserProfile;
  }
}
