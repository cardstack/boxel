import { waitUntil } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';

import {
  APP_BOXEL_RESPONSE_STREAM_EVENT_TYPE,
  APP_BOXEL_TOOL_RESULT_EVENT_TYPE,
} from '@cardstack/runtime-common/matrix-constants';

import type MessageTool from '@cardstack/host/lib/matrix-classes/message-tool';
import type ToolService from '@cardstack/host/services/tool-service';

import type { MockUtils } from './mock-matrix/_utils';

/**
 * A recorded AI assistant room, played back into the real panel through the
 * mock Matrix server, so a motion bug can be watched and re-run from the
 * room it happened in. `inspect-room.mjs replay <roomId>` (the
 * inspect-ai-room skill) writes one from a local, staging or production
 * room; the format is small enough to write by hand.
 *
 * `at` is milliseconds from the first event. Events in the `history` phase
 * are the room as it stood when the reader opened it: they land at once,
 * before the transcript's motion wakes, so they never animate. The rest play
 * on the clock.
 */
export interface RoomReplayFixture {
  version: 1;
  description: string;
  source?: {
    env?: string;
    roomId?: string;
    exportedAt?: string;
    /** text replaced by filler of the same shape (the exporter's default) */
    anonymized?: boolean;
    notes?: string[];
  };
  /** per-fixture overrides of the probe's limits */
  limits?: Record<string, number>;
  events: ReplayEvent[];
}

export type ReplayEvent = ReplayRoomEvent | ReplayPreview;

/** a room event, as Matrix delivered it */
export interface ReplayRoomEvent {
  at: number;
  kind: 'room';
  phase?: 'history' | 'turn';
  /** the recorded event id: later events refer to it, and get the new one */
  id?: string;
  sender: 'user' | 'bot';
  /** the event type; `m.room.message` when absent */
  type?: string;
  content: Record<string, unknown>;
}

/**
 * One streamed state of a bot reply, as the bot sends it over to-device
 * (`app.boxel.response-stream`): the reply so far, never a delta. Only the
 * reply's final edit lands in the room, so an exported room's previews are
 * made up from that edit at the bot's own cadence.
 */
export interface ReplayPreview {
  at: number;
  kind: 'preview';
  /** the recorded id of the reply's placeholder event */
  parent: string;
  body: string;
  reasoning?: string;
  toolRequests?: unknown[];
}

interface ReplayContext {
  roomId: string;
  mockMatrixUtils: MockUtils;
  /** the reader's Matrix id: the room's `user` sender */
  userId: string;
  /** the bot's Matrix id: the room's `bot` sender */
  botId?: string;
  /** 1 plays at the recorded pace; 0.25 at a quarter of it */
  speed?: number;
  /** called as each event is sent, for a probe to mark its frames */
  onEvent?: (label: string) => void;
  /**
   * Sends one of the reader's prompts the way the reader did (the
   * composer). The panel treats its own tab's send differently from a
   * message that just arrives: it shows it pending, then follows the end
   * for the reply. Without this, prompts arrive like messages sent from
   * another device. Nothing later in a room refers to a prompt's id, so the
   * id it is sent as is not needed.
   */
  sendPrompt?: (body: string) => Promise<void>;
}

export interface RoomReplay {
  /** posts the history phase at once */
  history(): Promise<void>;
  /** plays the rest on the clock, and resolves once the last event is in */
  play(): Promise<void>;
}

export function createRoomReplay(
  fixture: RoomReplayFixture,
  context: ReplayContext,
): RoomReplay {
  let {
    roomId,
    mockMatrixUtils,
    userId,
    botId = '@aibot:localhost',
    speed = 1,
    onEvent,
    sendPrompt,
  } = context;
  let { simulateRemoteMessage, simulateToDeviceEvent } = mockMatrixUtils;
  let matrixService = getService('matrix-service');
  let toolService = getService('tool-service');
  let ids = new Map<string, string>();
  let sequences = new Map<string, number>();

  holdToolCalls(toolService);

  // every recorded event id in the event, swapped for the one it was sent as
  let remap = (value: unknown): unknown => {
    if (typeof value === 'string') {
      return ids.get(value) ?? value;
    }
    if (Array.isArray(value)) {
      return value.map(remap);
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, remap(v)]),
      );
    }
    return value;
  };

  let send = async (event: ReplayEvent) => {
    if (event.kind === 'preview') {
      let parent = ids.get(event.parent);
      if (!parent) {
        throw new Error(
          `replay: preview for ${event.parent}, which has not been sent`,
        );
      }
      let sequence = sequences.get(parent) ?? 0;
      sequences.set(parent, sequence + 1);
      onEvent?.('preview');
      simulateToDeviceEvent(
        APP_BOXEL_RESPONSE_STREAM_EVENT_TYPE,
        {
          roomId,
          parentEventId: parent,
          sequence,
          body: event.body,
          reasoning: event.reasoning ?? '',
          toolRequests: event.toolRequests ?? [],
        },
        botId,
      );
      return;
    }
    let content = remap(event.content) as Record<string, any>;
    // The reader's own tab sent the prompts, so its tab owns the replies:
    // the panel shows them as it did (the cap, a call's "applying"), and
    // the held tool calls below keep them from running for real.
    if (event.sender === 'bot' && content.data?.context?.agentId) {
      content.data = {
        ...content.data,
        context: { ...content.data.context, agentId: matrixService.agentId },
      };
    }
    let type = event.type ?? 'm.room.message';
    onEvent?.(labelOf(event, type, content));
    if (
      sendPrompt &&
      event.phase !== 'history' &&
      event.sender === 'user' &&
      type === 'm.room.message' &&
      !content['m.relates_to'] &&
      typeof content.body === 'string'
    ) {
      await sendPrompt(content.body);
      return;
    }
    let newId = simulateRemoteMessage(
      roomId,
      event.sender === 'bot' ? botId : userId,
      content,
      type === 'm.room.message' ? undefined : { type },
    );
    if (event.id) {
      ids.set(event.id, newId);
    }
    if (type === APP_BOXEL_TOOL_RESULT_EVENT_TYPE) {
      await releaseToolCall(content.commandRequestId);
    }
  };

  // A held call shows "applying" until its recorded result is in, as it
  // did while the reader's host ran it; then the result decides.
  let releaseToolCall = async (callId: unknown) => {
    if (typeof callId !== 'string') {
      return;
    }
    try {
      await waitUntil(() => toolCallStatusOf(roomId, callId) !== undefined, {
        timeout: 3000,
      });
    } catch {
      // the result never reached the room resource: let the call go anyway
    }
    toolService.currentlyExecutingToolRequestIds.delete(callId);
    toolService.executedToolRequestIds.add(callId);
  };

  let isHistory = (e: ReplayEvent) =>
    e.kind === 'room' && e.phase === 'history';

  return {
    async history() {
      let history = fixture.events.filter(isHistory);
      for (let event of history) {
        await send(event);
      }
      // the reader had read all of it: the room does not take them back to
      // a first unread message. A receipt names a message, so a last event
      // that edits one names the message it edits.
      let last = history.at(-1);
      if (last?.kind === 'room') {
        let relation = last.content['m.relates_to'] as
          | { rel_type?: string; event_id?: string }
          | undefined;
        let recorded =
          relation?.rel_type === 'm.replace' ? relation.event_id : last.id;
        let lastId = recorded ? ids.get(recorded) : undefined;
        if (lastId) {
          mockMatrixUtils.setReadReceipt(roomId, lastId, userId);
        }
      }
    },
    async play() {
      let turn = fixture.events.filter((e) => !isHistory(e));
      let first = turn[0]?.at ?? 0;
      let start = performance.now();
      for (let event of turn) {
        let due = start + (event.at - first) / speed;
        let wait = due - performance.now();
        if (wait > 0) {
          // the recording's own clock: replaying it is the point
          await new Promise((r) => setTimeout(r, wait));
        }
        await send(event);
      }
    },
  };
}

/**
 * The host runs the tool calls its own tab's replies make. A replayed call
 * already has its recorded result, and running it here would add a second
 * one, so the call is held instead: marked as running, the way the reader
 * saw it, until the replay posts its result.
 */
function holdToolCalls(toolService: ToolService) {
  let held = {
    perform(command: MessageTool) {
      if (command.id) {
        toolService.currentlyExecutingToolRequestIds.add(command.id);
      }
      return Promise.resolve();
    },
    unlinked() {
      return held;
    },
  };
  (toolService as unknown as { run: unknown }).run = held;
}

function toolCallStatusOf(roomId: string, callId: string) {
  let room = getService('matrix-service').roomResources.get(roomId);
  for (let message of room?.messages ?? []) {
    for (let tool of message.tools ?? []) {
      if (tool.id === callId) {
        let status = tool.toolCallStatus;
        return status === 'ready' || status === 'applying' ? undefined : status;
      }
    }
  }
  return undefined;
}

function labelOf(
  event: ReplayRoomEvent,
  type: string,
  content: Record<string, any>,
) {
  if (type !== 'm.room.message') {
    return `${event.sender}:${type.replace('app.boxel.', '')}`;
  }
  if (content['m.relates_to']?.rel_type === 'm.replace') {
    return `${event.sender}:edit${content.isStreamingFinished ? ':final' : ''}`;
  }
  return `${event.sender}:message`;
}
