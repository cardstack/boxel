import { contains, field, StringField } from '@cardstack/base/card-api';

import Task from '../task';

/**
 * Quest Log's task: the shared Task block extended additively. The only
 * app-specific fact a hobby task carries is what "done" means to its owner —
 * completion is subjective here, and the criteria text records the owner's
 * own bar. Lifecycle, priority, due date, nesting all come from the block.
 */
export class QuestTask extends Task {
  static displayName = 'Quest Task';

  @field completionCriteria = contains(StringField, {
    description:
      'The owner\'s own bar for done, e.g. "play it cleanly at 120 BPM".',
  });
}

export default QuestTask;
