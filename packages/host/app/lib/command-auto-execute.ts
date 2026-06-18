import type { LLMMode } from '@cardstack/runtime-common/matrix-constants';

import type MessageCommand from './matrix-classes/message-command';

export const CHECK_CORRECTNESS_COMMAND_NAME = 'checkCorrectness';

// Single source of truth for "this command runs without user approval".
// Used by command-service (to decide whether to auto-run) and by the room
// component (to decide whether to render the Accept All / Cancel bar).
// Keeping both call sites on the same predicate prevents the two from
// drifting and reintroducing the action-bar flash that prompted CS-11647.
export function isAutoExecutableCommand(
  command: Pick<MessageCommand, 'name' | 'requiresApproval'>,
  activeLLMMode: LLMMode | undefined,
): boolean {
  if (command.name === CHECK_CORRECTNESS_COMMAND_NAME) {
    return true;
  }
  if (command.requiresApproval === false) {
    return true;
  }
  return activeLLMMode === 'act';
}
