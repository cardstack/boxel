import { IRoomEvent } from 'matrix-js-sdk';

export function constructHistory(history: IRoomEvent[]) {
  const latestEventsMap = new Map<string, IRoomEvent>();
  for (let event of history) {
    let content = event.content;
    if (event.type == 'm.room.message') {
      let eventId = event.event_id!;
      if (content['m.relates_to']?.rel_type === 'm.replace') {
        eventId = content['m.relates_to']!.event_id!;
        event.event_id = eventId;
      }
      const existingEvent = latestEventsMap.get(eventId);
      if (
        !existingEvent ||
        existingEvent.origin_server_ts < event.origin_server_ts
      ) {
        latestEventsMap.set(eventId, event);
      }
    }
  }
  let latestEvents = Array.from(latestEventsMap.values());
  latestEvents.sort((a, b) => a.origin_server_ts - b.origin_server_ts);
  return latestEvents;
}

type ChatCompletion = {
  choices: Array<{
    delta?: {
      content?: string | null | undefined;
    };
  }>;
};

export async function* extractContentFromStream(
  iterable: AsyncIterable<ChatCompletion>,
) {
  for await (const part of iterable) {
    if (part.choices[0]?.delta?.content) {
      yield part.choices[0].delta.content;
    }
  }
}
