import { Command } from '@cardstack/runtime-common';

import {
  RecordLifecycleInput,
  RecordLifecycleResult,
  transitionRecordStatus,
} from './archive-record';

/**
 * The way back from Archive Record: returns a record to the working set by
 * writing `recordStatus` to Active. The pair are separate commands on purpose
 * — a consumer exposes archive on live records and restore on archived ones,
 * and never needs a "which direction?" argument.
 */
export default class RestoreRecordCommand extends Command<
  typeof RecordLifecycleInput,
  typeof RecordLifecycleResult
> {
  static actionVerb = 'Restore';
  static displayName = 'Restore Record';

  async getInputType() {
    return RecordLifecycleInput;
  }

  protected async run(
    input: RecordLifecycleInput,
  ): Promise<RecordLifecycleResult> {
    let message = await transitionRecordStatus(
      this.commandContext,
      input.card,
      'Active',
    );
    return new RecordLifecycleResult({ message });
  }
}
