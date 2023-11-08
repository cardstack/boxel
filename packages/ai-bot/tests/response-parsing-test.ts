import { module, test, assert } from 'qunit';
import {
  processStream,
  Message,
  extractContentFromStream,
  cleanContent,
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
  expected: Message[],
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
      { type: 'text', content: 'Hello', complete: false },
      { type: 'text', content: 'Hello World', complete: false },
      { type: 'text', content: 'Hello World', complete: true },
    ];
    await assertProcessedStreamContains(stream, expectedResult);
  });

  test('should preserve multiple whitespace', async () => {
    const stream = ['Hello', ' ', ' ', 'World'];
    const expectedResult = [
      { type: 'text', content: 'Hello', complete: false },
      { type: 'text', content: 'Hello ', complete: false },
      { type: 'text', content: 'Hello  ', complete: false },
      { type: 'text', content: 'Hello  World', complete: false },
      { type: 'text', content: 'Hello  World', complete: true }, // Note preserving the two whitespace characters
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
      { type: 'text', content: 'Hello', complete: false },
      { type: 'text', content: 'Hello', complete: true },
      { type: 'command', content: { some: 'thing' } },
      { type: 'text', content: 'there', complete: false },
      { type: 'text', content: 'there ', complete: false },
      { type: 'text', content: 'there World', complete: false },
      { type: 'text', content: 'there World', complete: true },
    ];
    await assertProcessedStreamContains(stream, expectedResult);
  });

  // Tests that the code correctly processes a stream containing only structured data
  test('should correctly process a stream containing only structured data', async () => {
    const stream = ['{', '"some"', ':', '"thing"', '}'];
    const expectedResult: Message[] = [
      { type: 'command', content: { some: 'thing' } },
    ];
    await assertProcessedStreamContains(stream, expectedResult);
  });

  test('should correctly handle a stream containing an empty string', async () => {
    const stream = [''];
    const expectedResult: Message[] = [
      { type: 'text', content: '', complete: false },
    ];
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
      { type: 'text', content: 'Option 1', complete: false },
      { type: 'text', content: 'Option 1', complete: true },
      { type: 'command', content: { some: 'thing' } },
      { type: 'text', content: 'Option 2', complete: false },
      { type: 'text', content: 'Option 2', complete: true },
      { type: 'command', content: { some: 'thing else' } },
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
        type: 'text',
        content: 'Certainly',
        complete: false,
      },
      {
        type: 'text',
        content: 'Certainly:',
        complete: false,
      },
      {
        type: 'text',
        content: 'Certainly:\n\n',
        complete: false,
      },
      {
        type: 'text',
        content: 'Certainly:\n\nOption',
        complete: false,
      },
      {
        type: 'text',
        content: 'Certainly:\n\nOption ',
        complete: false,
      },
      {
        type: 'text',
        content: 'Certainly:\n\nOption 1',
        complete: false,
      },
      {
        type: 'text',
        content: 'Certainly:\n\nOption 1:',
        complete: false,
      },
      {
        type: 'text',
        content: 'Certainly:\n\nOption 1:\n',
        complete: false,
      },
      {
        type: 'text',
        content: 'Certainly:\n\nOption 1:\n',
        complete: true,
      },
      {
        type: 'command',
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

  test('should be able to remove whitespace around the outside of the text', () => {
    const input = '   this is   \n   some text  \n ';
    const expectedResult = 'this is   \n   some text';
    const result = cleanContent(input);
    assert.equal(result, expectedResult);
  });

  test('should be able to remove markdown block quote delimiters', () => {
    const input = 'Next there is some json in ```json { "a": "json" } ```';
    const expectedResult = 'Next there is some json in  { "a": "json" }';
    const result = cleanContent(input);
    assert.equal(result, expectedResult);
  });

  test('should remove all backticks', () => {
    const input = 'Next there is some json in ``';
    const expectedResult = 'Next there is some json in';
    const result = cleanContent(input);
    assert.equal(result, expectedResult);
  });

  test('should not have just json at the end', () => {
    const input = 'Here is the option: json';
    const expectedResult = 'Here is the option:';
    const result = cleanContent(input);
    assert.equal(result, expectedResult);
  });
});
