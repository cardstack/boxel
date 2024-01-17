import type Owner from '@ember/owner';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { tracked } from '@glimmer/tracking';

import { restartableTask, all } from 'ember-concurrency';

import {
  FieldContainer,
  LoadingIndicator,
} from '@cardstack/boxel-ui/components';

import type MatrixService from '@cardstack/host/services/matrix-service';

export default class UserProfile extends Component {
  <template>
    <div class='wrapper'>
      <FieldContainer @label='User ID' @tag='label'>
        <div class='value' data-test-field-value='userId'>
          {{this.userId}}
        </div>
      </FieldContainer>
      <FieldContainer @label='Email' @tag='label'>
        <div class='value' data-test-field-value='email'>
          {{#if this.email}}
            {{this.email}}
          {{else}}
            - email not set -
          {{/if}}
        </div>
      </FieldContainer>
      <FieldContainer @label='Display Name' @tag='label'>
        <div class='value' data-test-field-value='displayName'>
          {{#if this.showLoading}}
            <LoadingIndicator />
          {{else}}
            {{this.displayName}}
          {{/if}}
        </div>
      </FieldContainer>
    </div>
    <style>
      .wrapper {
        padding: 0 var(--boxel-sp);
        margin: var(--boxel-sp) 0;
        background-color: var(--boxel-light);
        color: var(--boxel-dark);
      }

      .wrapper label {
        margin-top: var(--boxel-sp-sm);
      }

      .button-container {
        display: flex;
        justify-content: flex-end;
        padding: 0 var(--boxel-sp) var(--boxel-sp);
        background-color: var(--boxel-light);
      }
      .user-button {
        margin-left: var(--boxel-sp-xs);
      }
    </style>
  </template>

  @service private declare matrixService: MatrixService;
  @tracked private displayName: string | undefined;
  @tracked private email: string | undefined;

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

  private loadProfile = restartableTask(async () => {
    let [profile, threePid] = await all([
      this.matrixService.client.getProfileInfo(this.userId),
      this.matrixService.client.getThreePids(),
    ]);
    let { displayname: displayName } = profile;
    let { threepids } = threePid;
    this.email = threepids.find((t) => t.medium === 'email')?.address;
    this.displayName = displayName;
  });
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface UserProfile {
    'Matrix::UserProfile': typeof UserProfile;
  }
}
