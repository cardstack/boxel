import 'stream-chain';

const { chain } = require('stream-chain');

const { parser } = require('stream-json');
const Verifier = require('stream-json/utils/Verifier');
const verifier = new Verifier();
const { streamValues } = require('stream-json/streamers/StreamValues');
const { streamObject } = require('stream-json/streamers/StreamObject');

const { Readable } = require('node:stream');
import OpenAI from 'openai';
const openai = new OpenAI();

type ChatCompletion = {
  choices: Array<{
    delta?: {
      content?: string | null | undefined;
    };
  }>;
};

class RewindableAsyncGenerator<T> {
  private generator: AsyncGenerator<T>;
  private buffer: T[] = [];
  private checkpointed: boolean = false;
  private bufferIndex: number = 0;

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
    // If we're in rewind mode and haven't exhausted the buffer, return the next buffered item.
    if (this.bufferIndex < this.buffer.length) {
      return { value: this.buffer[this.bufferIndex++], done: false };
    }

    // Otherwise, get the next item from the generator.
    const result = await this.generator.next();

    // If we're checkpointed, add the item to the buffer.
    if (this.checkpointed && !result.done) {
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
    this.checkpointed = true;
    this.buffer = [];
    this.bufferIndex = 0;
  }

  rewind(): void {
    this.bufferIndex = 0;
  }
}

export async function* extractContentFromStream(
  iterable: AsyncIterable<ChatCompletion>,
) {
  let all_tokens = [];
  for await (const part of iterable) {
    let content = part.choices[0]?.delta?.content;
    if (content) {
      for (let token of content.split(/([{}])/)) {
        yield token;
      }
      all_tokens.push(content);
    }
  }
  console.log('all tokens', all_tokens.join(' '));
}

async function* prependedStream(
  prepend: string,
  stream: AsyncIterable<string>,
) {
  yield prepend;
  for await (const part of stream) {
    yield part;
  }
}

(async () => {
  console.log('Hello');
  let input_stream = await openai.chat.completions.create({
    model: 'gpt-3.5-turbo',
    messages: [
      {
        role: 'user',
        content:
          'say hello then  give me a few json objects interspersed with text',
      },
    ],
    stream: true,
  });
  let extracted_non = (async function* () {
    let text =
      'Hello, this is some generic text {"foo": "bar"} and that was json';
    let words = text.split(' ');
    for (let word of words) {
      //console.log('Emitting', word);
      yield word;
      //console.log('Finished emitting', word);
    }
  })();

  let extracted = new RewindableAsyncGenerator(
    extractContentFromStream(input_stream),
  );
  let tokens_to_parse = [];
  let jsonParsing = false;
  let buffer = [];
  for await (const part of extracted) {
    if (part.includes('{')) {
      //verifier.on('error', (error) => console.log(error));

      //Readable.from(prependedStream(part, extracted)).pipe(verifier);
      jsonParsing = true;
      let parserInstance = parser({ jsonStreaming: true });
      let streamValuesInstance = streamValues();
      let readable = Readable.from(prependedStream(part, extracted));
      const pipeline = chain([readable, parserInstance, streamValuesInstance]);
      const endOfStream = new Promise((resolve, reject) => {
        pipeline.on('end', resolve);
        pipeline.on('error', reject);
      });

      pipeline.on('data', (x) => {
        console.log('JSON', x.value);
        jsonParsing = false;
        extracted.checkpoint();
      });

      try {
        await endOfStream;
        console.log('Stream ended');
      } catch (error) {
        console.log("Let's roll back");
        extracted.rewind();
      }
    } else {
      console.log('Text:', part);
    }
  }
})().catch((e) => {
  console.log(e);
  process.exit(1);
});
