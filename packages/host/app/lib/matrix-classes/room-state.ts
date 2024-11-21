import { tracked } from '@glimmer/tracking';

import type { Skill } from '@cardstack/host/components/ai-assistant/skill-menu';

import type { MatrixEvent as DiscreteMatrixEvent } from 'https://cardstack.com/base/matrix-event';

export default class RoomState {
  @tracked events: DiscreteMatrixEvent[] = [];
  @tracked skills: Skill[] = [];
}
