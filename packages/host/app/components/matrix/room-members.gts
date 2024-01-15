import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';

import {
  BoxelInput,
  Button,
  FieldContainer,
  LoadingIndicator,
} from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';

import type MatrixService from '@cardstack/host/services/matrix-service';

interface Signature {
  Args: {
    roomId: string;
    memberNames: string;
  };
}

export default class RoomMembers extends Component<Signature> {
  <template>
    <section class='room-members'>
      <div class='member-names' data-test-room-members>
        <strong>Members:</strong>
        {{@memberNames}}
      </div>
      {{#if this.isInviteFormShown}}
        {{#if this.doInvite.isRunning}}
          <LoadingIndicator />
        {{/if}}
        <div class='invite-form'>
          <FieldContainer @label='Invite:' @tag='label'>
            <BoxelInput
              type='text'
              @value={{this.membersToInviteFormatted}}
              @onInput={{this.setMembersToInvite}}
              data-test-room-invite-field
            />
          </FieldContainer>
          <div class='invite-button-wrapper'>
            <Button
              @kind='secondary-dark'
              {{on 'click' this.cancelInvite}}
              data-test-room-invite-cancel-btn
            >
              Cancel
            </Button>
            <Button
              @kind='primary'
              {{on 'click' this.invite}}
              @disabled={{eq this.membersToInvite.length 0}}
              data-test-room-invite-btn
            >
              Invite
            </Button>
          </div>
        </div>
      {{else}}
        <Button
          @kind='secondary-dark'
          {{on 'click' this.showInviteForm}}
          @disabled={{this.isInviteFormShown}}
          data-test-invite-mode-btn
        >
          Invite Members
        </Button>
      {{/if}}
    </section>

    <style>
      .member-names {
        margin-bottom: var(--boxel-sp);
        display: flex;
        justify-content: space-between;
        flex-wrap: wrap;
      }
      .invite-form :deep(.boxel-field) {
        padding-right: 0;
      }
      .invite-form :deep(.boxel-label) {
        color: var(--boxel-light);
      }
      .invite-button-wrapper {
        display: flex;
        justify-content: flex-end;
        gap: var(--boxel-sp-xs);
        margin-top: var(--boxel-sp);
      }
    </style>
  </template>

  @service private declare matrixService: MatrixService;

  @tracked private isInviteFormShown = false;
  @tracked private membersToInvite: string[] = [];

  @action
  private showInviteForm() {
    this.isInviteFormShown = true;
  }

  private get membersToInviteFormatted() {
    return this.membersToInvite.join(', ');
  }

  @action
  private setMembersToInvite(invite: string) {
    this.membersToInvite = invite.split(',').map((i) => i.trim());
  }

  @action
  private cancelInvite() {
    this.resetInvite();
  }

  @action
  private invite() {
    this.doInvite.perform();
  }

  private doInvite = restartableTask(async () => {
    await this.matrixService.invite(this.args.roomId, this.membersToInvite);
    this.resetInvite();
  });

  private resetInvite() {
    this.membersToInvite = [];
    this.isInviteFormShown = false;
  }
}
