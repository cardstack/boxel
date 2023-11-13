import { IRoomEvent } from 'matrix-js-sdk';
import { chain } from 'stream-chain';
import { parser } from 'stream-json';
import { streamValues } from 'stream-json/streamers/StreamValues';
import { Readable } from 'node:stream';

const MODIFY_SYSTEM_MESSAGE =
  '\
You are able to modify content according to user requests as well as answer questions for them. You may ask any followup questions you may need.\
If a user may be requesting a change, respond politely but not ingratiatingly to the user. The more complex the request, the more you can explain what you\'re about to do.\
\
Along with the changes you want to make, you must include the card ID of the card being changed. The original card. \
Return up to 3 options for the user to select from, exploring a range of things the user may want. If the request has only one sensible option or they ask for something very directly you don\'t need to return more than one. The format of your response should be\
```\
Explanatory text\
Option 1: Description\
{\
  "id": "originalCardID",\
  "patch": {\
    ...\
  }\
}\
\
Option 2: Description\
{\
  "id": "originalCardID",\
  "patch": {\
    ...\
  }\
}\
\
Option 3: Description\
\
{\
  "id": "originalCardID",\
  "patch": {\
    ...\
  }\
}\
```\
The data in the option block will be used to update things for the user behind a button so they will not see the content directly - you must give a short text summary before the option block.\
Return only JSON inside each option block, in a compatible format with the one you receive. The contents of any field will be automatically replaced with your changes, and must follow a subset of the same format - you may miss out fields but cannot add new ones. Do not add new nested components, it will fail validation.\
Modify only the parts you are asked to. Only return modified fields.\
You must not return any fields that you do not see in the input data.\
Never prefix json responses with `json`\
If the user hasn\'t shared any cards with you or what they\'re asking for doesn\'t make sense for the card type, you can ask them to "send their open cards" to you.';

type ChatCompletion = {
  choices: Array<{
    delta?: {
      content?: string | null | undefined;
    };
  }>;
};

type CommandMessage = {
  type: 'command';
  content: any;
};

type TextMessage = {
  type: 'text';
  content: string;
  complete: boolean;
};

export type Message = CommandMessage | TextMessage;

export function constructHistory(history: IRoomEvent[]) {
  /**
   * We send a lot of events to create messages,
   * as we stream updates to the UI. This works by
   * sending a new event with the full content and
   * information about which event it should replace
   *
   * This function is to construct the chat as a user
   * would see it - with only the latest event for each
   * message.
   */
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

export async function* extractContentFromStream(
  iterable: AsyncIterable<ChatCompletion>,
) {
  /**
   * The OpenAI API returns a stream of updates, which
   * have extra details that we don't need, this function
   * extracts out just the content from the stream.
   *
   * It also splits the content around { and } so that
   * we can parse JSON more cleanly
   */
  for await (const part of iterable) {
    let content = part.choices[0]?.delta?.content;
    if (content) {
      // Regex splits keep the delimiters
      for (let token of content.split(/([{}])/)) {
        if (token) {
          yield token;
        }
      }
    }
  }
}

export class CheckpointedAsyncGenerator<T> {
  private generator: AsyncGenerator<T>;
  private buffer: T[] = [];
  private bufferIndex = 0;

  constructor(generator: AsyncGenerator<T>) {
    this.generator = generator;
  }

  async *[Symbol.asyncIterator]() {
    while (true) {
      const next = await this.next();
      if (next.done) {
        return;
      }
      yield next.value;
    }
  }

  async next(): Promise<IteratorResult<T>> {
    // If we're in the past and haven't exhausted the buffer, return the next buffered item.
    if (this.bufferIndex < this.buffer.length) {
      return { value: this.buffer[this.bufferIndex++], done: false };
    }

    // Otherwise, get the next item from the generator.
    const result = await this.generator.next();

    // If we're checkpointed, add the item to the buffer.
    if (!result.done) {
      this.buffer.push(result.value);
      this.bufferIndex++;
    }

    return result;
  }

  async return(value?: any): Promise<IteratorResult<T>> {
    if (this.generator.return) {
      return await this.generator.return(value);
    }
    return { value, done: true };
  }

  async throw(error?: any): Promise<IteratorResult<T>> {
    if (this.generator.throw) {
      return await this.generator.throw(error);
    }
    throw error;
  }

  checkpoint(): void {
    // Cut the buffer to hold from buffer index to the end
    if (this.bufferIndex < this.buffer.length) {
      this.buffer = this.buffer.slice(this.bufferIndex);
    } else {
      this.buffer = [];
    }

    this.bufferIndex = 0;
  }

  restore(): void {
    this.bufferIndex = 0;
  }
}

async function* prependedStream<T>(prepend: T, stream: AsyncIterable<T>) {
  yield prepend;
  for await (const part of stream) {
    yield part;
  }
}

export async function* processStream(stream: AsyncGenerator<string>) {
  let tokenStream = new CheckpointedAsyncGenerator(stream);
  let currentMessage = '';
  for await (const part of tokenStream) {
    // If we see an opening brace, we *might* be looking at JSON
    // Optimistically start parsing it, and if we hit an error
    // then roll back to the last checkpoint
    if (part == '{') {
      // If we were processing text and now are probably looking at
      // JSON, yield the text we've seen so far, marked as "complete"
      // If there's no text, we don't need to yield anything
      // Typically this happens when a { is the very first token
      if (currentMessage) {
        yield {
          type: 'text',
          content: currentMessage,
          complete: true,
        };
      }
      let commands: string[] = [];
      const pipeline = chain([
        Readable.from(prependedStream(part, tokenStream)), // We need to prepend the { back on
        parser({ jsonStreaming: true }),
        streamValues(),
      ]);

      // Setup this promise so we can await the json parsing to complete
      const endOfStream = new Promise((resolve, reject) => {
        pipeline.on('end', resolve);
        pipeline.on('error', reject);
      });

      pipeline.on('data', (x) => {
        commands.push(x.value);
        // We've found some JSON so we don't want to
        // keep building up the text
        currentMessage = '';
        // If we've seen a command, bump the checkpoint
        // of the stream to the current position
        tokenStream.checkpoint();
      });

      try {
        await endOfStream;
      } catch (error) {
        // We've hit an error parsing something, so let's roll
        // back to the last checkpoint so we don't lose the
        // processed tokens
        tokenStream.restore();
      } finally {
        // We've either finished parsing the stream and have
        // one or more JSON objects, or we've hit an error.
        // The error may occur after successfully parsing a
        // JSON object, so we need to yield any commands
        // we've found.
        for (let command of commands) {
          yield {
            type: 'command',
            content: command,
          };
        }
      }
    } else {
      currentMessage += part;
      yield {
        type: 'text',
        content: currentMessage,
        complete: false,
      };
    }
    // Checkpoint before we start processing the next token
    tokenStream.checkpoint();
  }
  if (currentMessage) {
    yield {
      type: 'text',
      content: currentMessage,
      complete: true,
    };
  }
}

interface OpenAIPromptMessage {
  /**
   * The contents of the message. `content` is required for all messages, and may be
   * null for assistant messages with function calls.
   */
  content: string | null;
  /**
   * The role of the messages author. One of `system`, `user`, `assistant`, or
   * `function`.
   */
  role: 'system' | 'user' | 'assistant' | 'function';
}

export function getRelevantCards(history: IRoomEvent[], aiBotUserId: string) {
  let cards = [];
  for (let event of history) {
    if (event.sender !== aiBotUserId) {
      let content = event.content;
      // If a user has uploaded a card, add it to the context
      // It's the best we have
      if (content.msgtype === 'org.boxel.card') {
        cards.push(content.instance);
      } else if (content.msgtype === 'org.boxel.message') {
        // If a user has switched to sharing their current context
        // and they have open cards then use those
        if (content.context.openCards.length > 0) {
          cards = content.context.openCards.map(
            (card: { data: any }) => card.data,
          );
        }
      } else {
        cards = [];
      }
    }
  }
  return cards;
}

export function getModifyPrompt(history: IRoomEvent[], aiBotUserId: string) {
  // Need to make sure the passed in username is a full id
  if (
    aiBotUserId.indexOf(':') === -1 ||
    aiBotUserId.startsWith('@') === false
  ) {
    throw new Error("Username must be a full id, e.g. '@ai-bot:localhost'");
  }
  let historicalMessages: OpenAIPromptMessage[] = [];
  for (let event of history) {
    let body = event.content.body;
    if (body) {
      if (event.sender === aiBotUserId) {
        historicalMessages.push({
          role: 'assistant',
          content: body,
        });
      } else {
        historicalMessages.push({
          role: 'user',
          content: body,
        });
      }
    }
  }

  let systemMessage =
    MODIFY_SYSTEM_MESSAGE +
    `
  The user currently has given you the following data to work with:
  Cards:\n`;
  for (let card of getRelevantCards(history, aiBotUserId)) {
    systemMessage += `Full data: ${JSON.stringify(card)}
  You may only patch the following fields for this card: ${JSON.stringify(
    card.attributes,
  )}`;
  }

  let messages: OpenAIPromptMessage[] = [
    {
      role: 'system',
      content: systemMessage,
    },
  ];

  messages = messages.concat(historicalMessages);
  return messages;
}

export function cleanContent(content: string) {
  content = content.trim();
  content = content.replace(/```json/g, '');
  content = content.replace(/`/g, '');
  if (content.endsWith('json')) {
    content = content.slice(0, -4);
  }
  return content.trim();
}
