import { module, test, assert } from 'qunit';
import { processStream, ParsingMode, Message } from '../helpers';

async function* streamGenerator(stream: string[]) {
  for (const chunk of stream) {
    yield chunk;
  }
}

async function assertProcessedStreamContains(
  stream: string[],
  expected: { type: ParsingMode; content: string }[],
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

  test('should preserve whitespace but not send whitespace only updates', async () => {
    const stream = ['Hello', ' ', ' ', 'World'];
    const expectedResult = [
      { type: ParsingMode.Text, content: 'Hello' },
      { type: ParsingMode.Text, content: 'Hello  World' }, // Note preserving the two whitespace characters
    ];
    await assertProcessedStreamContains(stream, expectedResult);
  });

  test('should extract out the option blocks', async () => {
    const stream = [
      'Hello',
      '<option>',
      '{',
      '"some"',
      ':',
      '"thing"',
      '}',
      '</option>',
      'there',
      ' ',
      'World',
    ];
    const expectedResult = [
      { type: ParsingMode.Text, content: 'Hello' },
      { type: ParsingMode.Command, content: '{"some":"thing"}' },
      { type: ParsingMode.Text, content: 'there' },
      { type: ParsingMode.Text, content: 'there World' },
    ];
    await assertProcessedStreamContains(stream, expectedResult);
  });

  // Tests that the code correctly processes a stream containing only structured data
  test('should correctly process a stream containing only structured data', async () => {
    const stream = [
      '<option>',
      '{',
      '"some"',
      ':',
      '"thing"',
      '}',
      '</option>',
    ];
    const expectedResult = [
      { type: ParsingMode.Command, content: '{"some":"thing"}' },
    ];
    await assertProcessedStreamContains(stream, expectedResult);
  });

  test('should correctly handle a stream containing an empty string', async () => {
    const stream = [''];
    const expectedResult: Message[] = [];
    await assertProcessedStreamContains(stream, expectedResult);
  });

  test('should handle multiple option blocks', async () => {
    const stream = [
      'Option 1',
      '<option>',
      '{',
      '"some"',
      ':',
      '"thing"',
      '}',
      '</option>',
      'Option 2',
      '<option>',
      '{',
      '"some"',
      ':',
      '"thing else"',
      '}',
      '</option>',
    ];
    const expectedResult = [
      { type: ParsingMode.Text, content: 'Option 1' },
      { type: ParsingMode.Command, content: '{"some":"thing"}' },
      { type: ParsingMode.Text, content: 'Option 2' },
      { type: ParsingMode.Command, content: '{"some":"thing else"}' },
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
      '```',
      '<option',
      '>\n',
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
      '</',
      'option',
      '>',
      '```',
    ];
    const expectedResult = [
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
        content: 'Certainly:\n\nOption',
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
        type: ParsingMode.Command,
        content:
          '\n{  \n  "id": "http://localhost:4201/drafts/Pet/2",  \n  "patch": {    \n    "firstName": "ModifiedName"  \n  }\n}\n',
      },
    ];
    await assertProcessedStreamContains(stream, expectedResult);
  });
});
