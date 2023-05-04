import Component from '@glimmer/component';
import { service } from '@ember/service';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { BoxelHeader, Button, FieldContainer } from '@cardstack/boxel-ui';
import { dropTask } from 'ember-concurrency';
import type MatrixService from '../services/matrix-service';

const TRUE = true;

export default class UserProfile extends Component {
  <template>
    <BoxelHeader @title='User Profile' @hasBackground={{TRUE}}>
      <:actions>
        <Button data-test-profile-edit-btn>Edit</Button>
        <Button data-test-logout-btn {{on 'click' this.logout}}>Logout</Button>
      </:actions>
    </BoxelHeader>

    <FieldContainer @label='User ID' @tag='label'>
      <div class='user-profile__value' data-test-field-value='userId'>
        {{this.userId}}
      </div>
    </FieldContainer>

    <FieldContainer @label='Display Name' @tag='label'>
      <div class='user-profile__value' data-test-field-value='displayName'>
        {{this.user.displayName}}
      </div>
    </FieldContainer>
  </template>

  @service declare matrixService: MatrixService;

  constructor(owner: unknown, args: any) {
    super(owner, args);
    if (!this.matrixService.isLoggedIn) {
      throw new Error(
        `cannot render UserProfile component when not logged into Matrix`
      );
    }
  }

  get userId() {
    return this.matrixService.client.getUserId()!; // This component only renders when we are logged in, so we'll always have a userId
  }

  get user() {
    return this.matrixService.client.getUser(this.userId);
  }

  @action
  logout() {
    this.doLogout.perform();
  }

  private doLogout = dropTask(async () => {
    await this.matrixService.logout();
  });
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface UserProfile {
    UserProfile: typeof UserProfile;
  }
}
