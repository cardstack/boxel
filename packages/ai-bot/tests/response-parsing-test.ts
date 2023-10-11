import { module, test, assert } from 'qunit';
import {
  processStream,
  ParsingMode,
  Message,
  extractContentFromStream,
} from '../helpers';

async function* streamGenerator(stream: string[]) {
  for (const chunk of stream) {
    yield chunk;
  }
}

async function* chatCompletionGenerator(stream: string[]) {
  for (const chunk of stream) {
    yield { choices: [{ delta: { content: chunk } }] };
  }
}

async function streamToArray(stream: AsyncIterable<string>) {
  const result = [];
  for await (const chunk of stream) {
    result.push(chunk);
  }
  return result;
}

async function assertProcessedStreamContains(
  stream: string[],
  expected: { type: ParsingMode; content: string | null }[],
) {
  const result = [];
  for await (const chunk of processStream(streamGenerator(stream))) {
    result.push(chunk);
  }
  assert.deepEqual(result, expected);
}

module('processStream', () => {
  test('should build up a stream where there is only text', async () => {
    const stream = ['Hello', ' World'];
    const expectedResult = [
      { type: ParsingMode.Text, content: 'Hello' },
      { type: ParsingMode.Text, content: 'Hello World' },
    ];
    await assertProcessedStreamContains(stream, expectedResult);
  });

  test('should preserve multiple whitespace', async () => {
    const stream = ['Hello', ' ', ' ', 'World'];
    const expectedResult = [
      { type: ParsingMode.Text, content: 'Hello' },
      { type: ParsingMode.Text, content: 'Hello ' },
      { type: ParsingMode.Text, content: 'Hello  ' },
      { type: ParsingMode.Text, content: 'Hello  World' }, // Note preserving the two whitespace characters
    ];
    await assertProcessedStreamContains(stream, expectedResult);
  });

  test('should extract out the option blocks', async () => {
    const stream = [
      'Hello',
      '{',
      '"some"',
      ':',
      '"thing"',
      '}',
      'there',
      ' ',
      'World',
    ];
    const expectedResult: Message[] = [
      { type: ParsingMode.Text, content: 'Hello' },
      { type: ParsingMode.Break, content: null },
      { type: ParsingMode.Command, content: { some: 'thing' } },
      { type: ParsingMode.Text, content: 'there' },
      { type: ParsingMode.Text, content: 'there ' },
      { type: ParsingMode.Text, content: 'there World' },
    ];
    await assertProcessedStreamContains(stream, expectedResult);
  });

  // Tests that the code correctly processes a stream containing only structured data
  test('should correctly process a stream containing only structured data', async () => {
    const stream = ['{', '"some"', ':', '"thing"', '}'];
    const expectedResult: Message[] = [
      { type: ParsingMode.Command, content: { some: 'thing' } },
    ];
    await assertProcessedStreamContains(stream, expectedResult);
  });

  test('should correctly handle a stream containing an empty string', async () => {
    const stream = [''];
    const expectedResult: Message[] = [{ type: ParsingMode.Text, content: '' }];
    await assertProcessedStreamContains(stream, expectedResult);
  });

  test('should handle multiple option blocks', async () => {
    const stream = [
      'Option 1',
      '{',
      '"some"',
      ':',
      '"thing"',
      '}',
      'Option 2',
      '{',
      '"some"',
      ':',
      '"thing else"',
      '}',
    ];
    const expectedResult: Message[] = [
      { type: ParsingMode.Text, content: 'Option 1' },
      { type: ParsingMode.Break, content: null },
      { type: ParsingMode.Command, content: { some: 'thing' } },
      { type: ParsingMode.Text, content: 'Option 2' },
      { type: ParsingMode.Break, content: null },
      { type: ParsingMode.Command, content: { some: 'thing else' } },
    ];
    await assertProcessedStreamContains(stream, expectedResult);
  });

  test('should extract correctly when options are distinct tokens', async () => {
    // A shortened version of a real response
    const stream = [
      'Certainly',
      ':',
      '\n\n',
      'Option',
      ' ',
      '1',
      ':',
      '\n',
      '{',
      '  \n',
      ' ',
      ' "',
      'id',
      '":',
      ' "',
      'http',
      '://',
      'localhost',
      ':',
      '420',
      '1',
      '/d',
      'raft',
      's',
      '/P',
      'et',
      '/',
      '2',
      '",',
      '  \n',
      ' ',
      ' "',
      'patch',
      '":',
      ' {',
      '    \n',
      '   ',
      ' "',
      'firstName',
      '":',
      ' "',
      'Modified',
      'Name',
      '"',
      '  \n',
      ' ',
      ' }\n',
      '}\n',
    ];
    const expectedResult: Message[] = [
      {
        type: ParsingMode.Text,
        content: 'Certainly',
      },
      {
        type: ParsingMode.Text,
        content: 'Certainly:',
      },
      {
        type: ParsingMode.Text,
        content: 'Certainly:\n\n',
      },
      {
        type: ParsingMode.Text,
        content: 'Certainly:\n\nOption',
      },
      {
        type: ParsingMode.Text,
        content: 'Certainly:\n\nOption ',
      },
      {
        type: ParsingMode.Text,
        content: 'Certainly:\n\nOption 1',
      },
      {
        type: ParsingMode.Text,
        content: 'Certainly:\n\nOption 1:',
      },
      {
        type: ParsingMode.Text,
        content: 'Certainly:\n\nOption 1:\n',
      },
      { type: ParsingMode.Break, content: null },
      {
        type: ParsingMode.Command,
        content: {
          id: 'http://localhost:4201/drafts/Pet/2',
          patch: { firstName: 'ModifiedName' },
        },
      },
    ];
    await assertProcessedStreamContains(stream, expectedResult);
  });

  test('should split responses around { and }', async () => {
    const stream = chatCompletionGenerator(['this is { "a": "json"}']);
    const expectedResult: string[] = ['this is ', '{', ' "a": "json"', '}'];
    const result: string[] = await streamToArray(
      extractContentFromStream(stream),
    );

    assert.deepEqual(result, expectedResult);
  });

  test('should split responses around { and } even if they are on their own', async () => {
    const stream = chatCompletionGenerator([
      'this is ',
      '{',
      ' "a": "json"',
      '}',
    ]);
    const expectedResult: string[] = ['this is ', '{', ' "a": "json"', '}'];
    const result: string[] = await streamToArray(
      extractContentFromStream(stream),
    );

    assert.deepEqual(result, expectedResult);
  });

  test('whitespace is not lost with splitting the tokens', async () => {
    const stream = chatCompletionGenerator([
      'this is   ',
      '  {',
      ' "a": "json"',
      '}  ',
      '  ',
      '  \n',
    ]);
    const expectedResult: string[] = [
      'this is   ',
      '  ',
      '{',
      ' "a": "json"',
      '}',
      '  ',
      '  ',
      '  \n',
    ];
    const result: string[] = await streamToArray(
      extractContentFromStream(stream),
    );

    assert.deepEqual(result, expectedResult);
  });
});
