import Component from '@glimmer/component';
import { service } from '@ember/service';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import {
  BoxelHeader,
  Button,
  FieldContainer,
  BoxelInput,
  LoadingIndicator,
} from '@cardstack/boxel-ui';
import { dropTask, restartableTask } from 'ember-concurrency';
import { tracked } from '@glimmer/tracking';
import { not } from '../helpers/truth-helpers';
import type MatrixService from '../services/matrix-service';

const TRUE = true;

export default class UserProfile extends Component {
  <template>
    <BoxelHeader @title='User Profile' @hasBackground={{TRUE}}>
      <:actions>
        {{#if (not this.isEditMode)}}
          <Button
            data-test-profile-edit-btn
            {{on 'click' this.doEdit}}
          >Edit</Button>
        {{/if}}
        <Button data-test-logout-btn {{on 'click' this.logout}}>Logout</Button>
      </:actions>
    </BoxelHeader>

    <FieldContainer @label='User ID' @tag='label'>
      <div class='user-profile__value' data-test-field-value='userId'>
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
        <div class='user-profile__value' data-test-field-value='displayName'>
          {{#if this.showLoading}}
            <LoadingIndicator />
          {{else}}
            {{this.displayName}}
          {{/if}}
        </div>
      {{/if}}
    </FieldContainer>
    {{#if this.isEditMode}}
      <Button
        data-test-profile-save-btn
        @disabled={{not this.displayName}}
        {{on 'click' this.save}}
      >Save</Button>
    {{/if}}
  </template>

  @service declare matrixService: MatrixService;
  @tracked isEditMode = false;
  @tracked displayName: string | undefined;
  @tracked userUpdateTime: number | undefined;

  constructor(owner: unknown, args: any) {
    super(owner, args);
    if (!this.matrixService.isLoggedIn) {
      throw new Error(
        `cannot render UserProfile component when not logged into Matrix`
      );
    }
    this.loadProfile.perform();
  }

  get userId() {
    return this.matrixService.client.getUserId()!; // This component only renders when we are logged in, so we'll always have a userId
  }

  get showLoading() {
    return !this.displayName && this.loadProfile.isRunning;
  }

  @action
  setDisplayName(displayName: string) {
    this.displayName = displayName;
  }

  @action
  doEdit() {
    this.isEditMode = true;
  }

  @action
  save() {
    this.doSave.perform();
  }

  @action
  logout() {
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
        `bug: should never get here, save button is disabled when there is no display name`
      );
    }
    await this.matrixService.client.setDisplayName(this.displayName);
    this.isEditMode = false;
  });
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface UserProfile {
    UserProfile: typeof UserProfile;
  }
}
