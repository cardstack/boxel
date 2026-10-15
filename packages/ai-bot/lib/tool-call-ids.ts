import type { MatrixEvent as DiscreteMatrixEvent } from 'matrix-js-sdk';
import { getToolRequests } from '@cardstack/runtime-common/matrix-constants';

// The host, ai-bot and prompt building all identify a tool call by its id
// (`toolRequest.id`, echoed as `commandRequestId` on its result) across the
// whole room. A provider only promises the id is unique within one reply: some
// backends number calls per reply (`run-realm-code_6b92:0` on every turn), and
// a reused id makes the host skip the new call as already run. So each call
// keeps the provider's id unless the room has used it already, in which case
// it gets a suffix that makes it unique.

// Every tool-call id the room has used, on bot messages (their edits
// included) and on results.
export function collectUsedToolCallIds(
  eventList: DiscreteMatrixEvent[],
): Set<string> {
  let used = new Set<string>();
  let addFrom = (content: Record<string, any> | undefined | null) => {
    if (!content || typeof content !== 'object') {
      return;
    }
    let requests = getToolRequests<{ id?: unknown }>(content);
    if (Array.isArray(requests)) {
      for (let request of requests) {
        if (typeof request?.id === 'string') {
          used.add(request.id);
        }
      }
    }
    if (typeof content.commandRequestId === 'string') {
      used.add(content.commandRequestId);
    }
  };
  for (let event of eventList) {
    let raw = event as any;
    addFrom(raw.content);
    addFrom(raw.content?.['m.new_content']);
    let replacement = raw.unsigned?.['m.relations']?.['m.replace'];
    addFrom(replacement?.content);
    addFrom(replacement?.content?.['m.new_content']);
  }
  return used;
}

// Assigns the ids for one reply's tool calls, by their position in the
// reply. The assignment for a position is fixed once made, so every streamed
// edit, the to-device preview, the final event and the bot-tool results carry
// the same id.
export class ToolCallIds {
  private used: Set<string>;
  private assigned = new Map<number, { providerId: string; id: string }>();

  constructor(used: Iterable<string> = []) {
    this.used = new Set(used);
  }

  idFor(index: number, providerId: string | undefined): string | undefined {
    if (!providerId) {
      return providerId;
    }
    let existing = this.assigned.get(index);
    if (existing?.providerId === providerId) {
      return existing.id;
    }
    if (existing) {
      this.used.delete(existing.id);
    }
    let id = providerId;
    for (let n = 1; this.used.has(id); n++) {
      id = `${providerId}_${n}`;
    }
    this.used.add(id);
    this.assigned.set(index, { providerId, id });
    return id;
  }

  // A copy of each call with its assigned id; the calls themselves (the
  // stream's own snapshot) are left untouched.
  apply<T extends { id?: string }>(toolCalls: T[]): T[] {
    return toolCalls.map((call, index) => {
      let id = this.idFor(index, call?.id);
      return call && id !== call.id ? { ...call, id } : call;
    });
  }
}
