import type { MatrixEvent as DiscreteMatrixEvent } from '@cardstack/base/matrix-event';
import {
  APP_BOXEL_COMPACTION_EVENT_TYPE,
  getToolRequests,
} from '@cardstack/runtime-common/matrix-constants';

// The host, ai-bot and prompt building all identify a tool call by its id
// (`toolRequest.id`, echoed as `commandRequestId` on its result) across the
// whole room. A provider only promises the id is unique within one reply: some
// backends number calls per reply (`run-realm-code_6b92:0` on every turn), and
// a reused id makes the host skip the new call as already run. So each call
// keeps the provider's id unless the room has used it already, in which case
// it gets a suffix that makes it unique.
//
// The room history ai-bot loads starts at the latest compaction's cut point,
// so the ids used before it travel on the compaction event
// (`usedToolCallIds`).

// The most ids a compaction event carries, which keeps it well inside
// Matrix's event size limit next to the summary.
export const MAX_CARRIED_TOOL_CALL_IDS = 500;

const SUFFIXED_ID = /^(.*)_(\d+)$/;

// Every tool-call id the room has used, on bot messages, on results, and
// carried by compaction events for the history before their cut. A streamed
// bot message carries its requests only on its latest edit, which the server
// aggregates under `unsigned['m.relations']['m.replace']`. Carried ids come
// first, as they are the oldest.
export function collectUsedToolCallIds(
  eventList: DiscreteMatrixEvent[],
): Set<string> {
  let used = new Set<string>();
  for (let event of eventList) {
    let { type, content } = event as {
      type: string;
      content?: { status?: string; usedToolCallIds?: unknown };
    };
    if (
      type === APP_BOXEL_COMPACTION_EVENT_TYPE &&
      content?.status === 'done' &&
      Array.isArray(content.usedToolCallIds)
    ) {
      for (let id of content.usedToolCallIds) {
        if (typeof id === 'string') {
          used.add(id);
        }
      }
    }
  }
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
    addFrom(raw.unsigned?.['m.relations']?.['m.replace']?.content);
  }
  return used;
}

// The used ids a compaction event carries forward. `ToolCallIds` suffixes a
// used id past the highest suffix in use, so of `x`, `x_1` and `x_2` only `x`
// and `x_2` need to be kept. When there are still more than `max`, the most
// recent are kept, and a base id stays as long as its highest suffix does:
// with the base gone, the provider's next `x` would be issued as `x` again.
export function toolCallIdsToCarry(
  used: Iterable<string>,
  max = MAX_CARRIED_TOOL_CALL_IDS,
): string[] {
  let ids = [...used];
  let present = new Set(ids);
  let highestSuffix = new Map<string, number>();
  for (let id of ids) {
    let match = SUFFIXED_ID.exec(id);
    if (match && present.has(match[1])) {
      let n = Number(match[2]);
      highestSuffix.set(
        match[1],
        Math.max(n, highestSuffix.get(match[1]) ?? 0),
      );
    }
  }
  let carried = ids.filter((id) => {
    let match = SUFFIXED_ID.exec(id);
    return !(
      match &&
      highestSuffix.has(match[1]) &&
      Number(match[2]) < highestSuffix.get(match[1])!
    );
  });
  if (carried.length <= max) {
    return carried;
  }
  // Each base id goes with its highest suffix, and the pair is as recent as
  // that suffix.
  let lineage = (id: string) => {
    let match = SUFFIXED_ID.exec(id);
    return match && highestSuffix.has(match[1]) ? match[1] : id;
  };
  let lastPosition = new Map<string, number>();
  carried.forEach((id, position) => lastPosition.set(lineage(id), position));
  let size = new Map<string, number>();
  for (let id of carried) {
    size.set(lineage(id), (size.get(lineage(id)) ?? 0) + 1);
  }
  let kept = new Set<string>();
  let count = 0;
  for (let key of [...lastPosition.keys()].sort(
    (a, b) => lastPosition.get(b)! - lastPosition.get(a)!,
  )) {
    if (count + size.get(key)! > max) {
      break;
    }
    kept.add(key);
    count += size.get(key)!;
  }
  return carried.filter((id) => kept.has(lineage(id)));
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

  // The next reply numbers its calls from position 0 again. The ids the
  // earlier reply was given stay used, so the next reply never gets one.
  startNewReply() {
    this.assigned.clear();
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
    if (this.used.has(id)) {
      // Past the highest suffix in use, not the lowest free one: a carried
      // list may have dropped the lower suffixes, which the room still holds.
      let n = this.highestSuffix(providerId) + 1;
      id = `${providerId}_${n}`;
      while (this.used.has(id)) {
        id = `${providerId}_${++n}`;
      }
    }
    this.used.add(id);
    this.assigned.set(index, { providerId, id });
    return id;
  }

  private highestSuffix(providerId: string): number {
    let highest = 0;
    for (let id of this.used) {
      let match = SUFFIXED_ID.exec(id);
      if (match && match[1] === providerId) {
        highest = Math.max(highest, Number(match[2]));
      }
    }
    return highest;
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
