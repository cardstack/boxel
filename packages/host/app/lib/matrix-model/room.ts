import { tracked } from '@glimmer/tracking';

import type { MatrixEvent as DiscreteMatrixEvent } from 'https://cardstack.com/base/matrix-event';

export class RoomModel {
  @tracked events: DiscreteMatrixEvent[] = [];
}
