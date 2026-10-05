import type { MatrixClient } from 'matrix-js-sdk';
import type { ChatCompletionMessageToolCall } from 'openai/resources';
import type {
  MatrixEvent as DiscreteMatrixEvent,
  Tool,
} from '@cardstack/base/matrix-event';
import type { DelegatedUserRealmSessionManager } from '../user-delegated-realm-server-session.ts';

// A tool ai-bot runs itself rather than leaving to the host. The bot offers
// it to the model alongside the room's tools, tags each call it makes as
// bot-run (the host records the call but never runs it), runs the calls
// after the response, and publishes each one's tool-result event, which
// starts the next turn. Each tool keeps everything particular to it behind
// this interface; the bot handles them all the same way.
export interface BotTool {
  name: string;
  // The LLM tool definition the model is offered.
  definition: Tool;
  // Whether this room may use the tool.
  isOffered(room: BotToolRoomFacts): boolean;
  // The timeline label for a call, from its (possibly partial) arguments:
  // the raw arguments carry no description of their own.
  label(argumentsJson: string): string;
  // The tool's state for one handler run: whatever it needs to know about
  // the room to hold or run this turn's calls.
  startTurn(room: BotToolRoom): Promise<BotToolTurn>;
  // Whether a call cut off mid-arguments still names enough to run, so the
  // bot carries on by itself rather than asking the user to.
  recoversFromCutOff?(argumentsJson: string): boolean;
}

export interface BotToolTurn {
  // Whether a call waits for the user's approval before it runs (see
  // approval.ts). A call that doesn't runs right after the response; one
  // that does runs once the user approves it.
  needsApproval(argumentsJson: string): boolean;
  // Runs calls and publishes each one's result, one at a time, in order.
  fulfill(
    calls: ChatCompletionMessageToolCall[],
    target: BotToolTarget,
  ): Promise<BotToolOutcome[]>;
}

// What decides whether a room is offered a tool.
export interface BotToolRoomFacts {
  humanMemberCount: number;
  // Whether delegated realm sessions are configured, so the bot can act on
  // a user's realm permissions.
  realmDelegation: boolean;
}

export interface BotToolRoom extends BotToolRoomFacts {
  history: DiscreteMatrixEvent[];
  aiBotUserId: string;
  client: MatrixClient;
  // The human the bot acts for in this room.
  onBehalfOf: string;
  delegatedUserRealmSessions: Pick<
    DelegatedUserRealmSessionManager,
    'getToken' | 'invalidate'
  >;
  // The bot tools this room is offered.
  offeredToolNames: ReadonlySet<string>;
}

// Where a run's results go.
export interface BotToolTarget {
  client: MatrixClient;
  roomId: string;
  // The bot message carrying the calls; their results relate back to it.
  requestEventId: string;
  agentId: string | undefined;
}

export interface BotToolOutcome {
  commandRequestId: string;
  // Whether the call's result reached the room.
  published: boolean;
}
