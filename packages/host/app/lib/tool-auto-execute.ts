import { AI_BOT_EXECUTOR } from '@cardstack/runtime-common/commands';
import type { LLMMode } from '@cardstack/runtime-common/matrix-constants';

import type MessageTool from './matrix-classes/message-tool';

export const CHECK_CORRECTNESS_COMMAND_NAME = 'checkCorrectness';

// Single source of truth for "this command runs without user approval".
// Used by tool-service (to decide whether to auto-run) and by the
// room / room-message-command components (to decide whether to render
// the Accept All bar and the per-command Apply button). Keeping all
// call sites on the same predicate prevents them from drifting and
// reintroducing the action-bar flash that prompted CS-11647.
//
// `isOwnedByCurrentAgent` mirrors the agentId gate in
// tool-service.drainCommandProcessingQueue: a command sent by
// another agent is never auto-executed, even if it would otherwise
// satisfy one of the three branches below. Callers that don't track
// agents (e.g. unit tests) can pass `true` to focus on the other
// conditions.
export function isAutoExecutableCommand(
  command: Pick<MessageTool, 'name' | 'requiresApproval' | 'executedBy'>,
  activeLLMMode: LLMMode | undefined,
  isOwnedByCurrentAgent: boolean,
): boolean {
  if (!isOwnedByCurrentAgent) {
    return false;
  }
  // ai-bot ran this one itself (e.g. readRealmFile); the host only records it
  // in the timeline and never executes it.
  if (command.executedBy === AI_BOT_EXECUTOR) {
    return false;
  }
  if (command.name === CHECK_CORRECTNESS_COMMAND_NAME) {
    return true;
  }
  if (command.requiresApproval === false) {
    return true;
  }
  return activeLLMMode === 'act';
}
