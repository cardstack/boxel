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

export enum ParsingMode {
  Text,
  Command,
}

export async function* processStream(stream: AsyncIterable<string>) {
  let content = '';
  let currentParsingMode: ParsingMode = ParsingMode.Text;
  let all_tokens = [];
  for await (const token of stream) {
    all_tokens.push(token);
    // The parsing here has to deal with a streaming response that
    // alternates between sections of text (to stream back to the client)
    // and structured data (to batch and send in one block)
    if (currentParsingMode === ParsingMode.Command) {
      if (token.includes('</')) {
        // Content is the text we have built up so far
        if (content.startsWith('option>')) {
          content = content.replace('option>', '');
        }
        if (content.startsWith('>')) {
          content = content.replace('>', '');
        }
        if (content.endsWith('>')) {
          content = content.replace('>', '');
        }
        content += token.split('</')[0];
        // We have the whole patch, so we can yield it
        yield {
          type: ParsingMode.Command,
          content: content,
        };
        content = '';
        currentParsingMode = ParsingMode.Text;
      } else {
        // We are in command mode, so we need to buffer the content
        content += token;
      }
    } else if (currentParsingMode === ParsingMode.Text) {
      if (token.includes('<')) {
        // Send the last update
        let beforeTag = token.split('<')[0];
        if (beforeTag) {
          yield {
            type: ParsingMode.Text,
            content: (content + beforeTag).trim(),
          };
        }
        currentParsingMode = ParsingMode.Command;
        content = '';
      } else {
        content += token;
        content = content.replace(/^option/, '');
        content = content.replace(/^>/, '');
        content = content.replace(/^`.*/, '');
        content = content.replace(/`.*$/, '');
        if (content.trim()) {
          yield {
            type: ParsingMode.Text,
            content: content.trim(),
          };
        }
      }
    }
  }
  console.log('all_tokens', all_tokens);
}
