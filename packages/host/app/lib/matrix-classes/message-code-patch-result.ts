import { setOwner } from '@ember/owner';
import type Owner from '@ember/owner';
import { inject as service } from '@ember/service';

import { tracked } from '@glimmer/tracking';

import type CommandService from '@cardstack/host/services/command-service';
import type MatrixService from '@cardstack/host/services/matrix-service';
import type StoreService from '@cardstack/host/services/store';

import { CodePatchStatus } from 'https://cardstack.com/base/matrix-event';

import { Message } from './message';

export default class MessageCodePatchResult {
  @tracked index: number;
  @tracked status: CodePatchStatus;

  constructor(
    public message: Message,
    public codePatchEventId: string,
    status: CodePatchStatus,
    index: number,
    owner: Owner,
  ) {
    setOwner(this, owner);

    this.index = index;
    this.status = status;
  }

  @service declare commandService: CommandService;
  @service declare matrixService: MatrixService;
  @service declare store: StoreService;
}
