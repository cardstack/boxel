import Component from '@glimmer/component';
import { service } from '@ember/service';
import { action } from '@ember/object';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { tracked } from '@glimmer/tracking';
import { not, eq } from '../helpers/truth-helpers';
import { restartableTask, timeout } from 'ember-concurrency';
import {
  BoxelHeader,
  BoxelInput,
  LoadingIndicator,
  BoxelInputValidationState,
  Button,
  FieldContainer,
} from '@cardstack/boxel-ui';
import { isMatrixError } from '../lib/matrix-utils';
import { eventDebounceMs } from '../services/matrix-service';
import type MatrixService from '../services/matrix-service';

const TRUE = true;

interface Args {
  Args: {
    roomId: string;
  };
}
export default class Room extends Component<Args> {
  <template>
    <div>Room Name: {{this.roomName}}</div>
  </template>

  @service private declare matrixService: MatrixService;

  constructor(owner: unknown, args: any) {
    super(owner, args);
  }

  get roomName() {
    return this.matrixService.roomNames.get(this.args.roomId);
  }
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Room {
    Room: typeof Room;
  }
}
