import { IRoomEvent } from 'matrix-js-sdk';
import { chain } from 'stream-chain';
import { parser } from 'stream-json';
import { streamValues } from 'stream-json/streamers/StreamValues';
import { Readable } from 'node:stream';

type ChatCompletion = {
  choices: Array<{
    delta?: {
      content?: string | null | undefined;
    };
  }>;
};

export enum ParsingMode {
  Text,
  Command,
}

type CommandMessage = {
  type: ParsingMode.Command;
  content: Map<string, any>;
};

type TextMessage = {
  type: ParsingMode.Text;
  content: string;
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
            type: ParsingMode.Command,
            content: command,
          };
        }
      }
    } else {
      currentMessage += part;
      yield {
        type: ParsingMode.Text,
        content: currentMessage,
      };
    }
    // Checkpoint before we start processing the next token
    tokenStream.checkpoint();
  }
}
