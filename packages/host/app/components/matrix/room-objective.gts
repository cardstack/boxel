import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';

import { Button } from '@cardstack/boxel-ui/components';

import {
  chooseCard,
  isMatrixCardError,
  catalogEntryRef,
} from '@cardstack/runtime-common';

import { type CatalogEntry } from 'https://cardstack.com/base/catalog-entry';

import type MatrixService from '@cardstack/host/services/matrix-service';

import { getRoom } from '../../resources/room';

interface Signature {
  Args: {
    roomId: string;
  };
}

export default class RoomObjective extends Component<Signature> {
  <template>
    <section class='room-objective'>
      {{#if this.showSetObjectiveButton}}
        <Button
          @kind='secondary-dark'
          {{on 'click' this.setObjective}}
          @disabled={{this.doSetObjective.isRunning}}
          data-test-set-objective-btn
        >
          Set Objective
        </Button>
      {{/if}}

      {{#if this.objective}}
        {{#if this.objectiveError}}
          <div class='error' data-test-objective-error>
            Error: cannot render card
            {{this.objectiveError.id}}:
            {{this.objectiveError.error.message}}
          </div>
        {{else}}
          <this.objectiveComponent />
        {{/if}}
      {{/if}}
    </section>

    <style>
      .room-objective {
        padding: var(--boxel-sp);
      }

      .error {
        color: var(--boxel-danger);
        font-weight: 'bold';
      }
    </style>
  </template>

  private roomResource = getRoom(this, () => this.args.roomId);
  @service private declare matrixService: MatrixService;
  @tracked private isAllowedToSetObjective: boolean | undefined;

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    this.doMatrixEventFlush.perform();
  }

  private doMatrixEventFlush = restartableTask(async () => {
    await this.matrixService.flushMembership;
    await this.matrixService.flushTimeline;
    await this.roomResource.loading;
    this.isAllowedToSetObjective =
      await this.matrixService.allowedToSetObjective(this.args.roomId);
  });

  private get objective() {
    return this.matrixService.roomObjectives.get(this.args.roomId);
  }

  private get objectiveComponent() {
    if (this.objective && !isMatrixCardError(this.objective)) {
      return this.objective.constructor.getComponent(
        this.objective,
        'embedded',
      );
    }
    return undefined;
  }

  private get objectiveError() {
    if (isMatrixCardError(this.objective)) {
      return this.objective;
    }
    return undefined;
  }

  private get showSetObjectiveButton() {
    return !this.objective && this.isAllowedToSetObjective;
  }

  @action
  private setObjective() {
    this.doSetObjective.perform();
  }

  private doSetObjective = restartableTask(async () => {
    // objective are currently non-primitive fields
    let catalogEntry = await chooseCard<CatalogEntry>({
      filter: {
        every: [
          {
            on: catalogEntryRef,
            eq: { isField: true },
          },
          {
            on: catalogEntryRef,
            eq: { isPrimitive: false },
          },
        ],
      },
    });
    if (catalogEntry) {
      await this.matrixService.setObjective(this.args.roomId, catalogEntry.ref);
    }
  });
}
