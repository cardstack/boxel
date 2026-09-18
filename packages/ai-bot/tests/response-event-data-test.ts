import QUnit from 'qunit';

import ResponseEventData, {
  cutOutsideCodeBlocks,
} from '../lib/matrix/response-event-data.ts';

const { module, test } = QUnit;

module('ResponseEventData continuation cuts', () => {
  const block = [
    '```gts',
    'http://test.com/hello-world.gts (new)',
    '╔═══ SEARCH ════╗',
    '╠═══════════════╣',
    'export class HelloWorld {}',
    '╚═══ REPLACE ═══╝',
    '```',
  ].join('\n');

  test('a cut that lands inside a block moves back to the fence', (assert) => {
    let intro = 'Writing the file now.\n\n';
    let content = intro + block + '\nDone.';
    // Propose a cut in the middle of the block body.
    let proposed = intro.length + block.indexOf('export class') + 5;
    let cut = cutOutsideCodeBlocks(content, 0, proposed);
    assert.strictEqual(
      content.slice(0, cut),
      intro,
      'the first part ends right before the opening fence',
    );
    assert.ok(
      content.slice(cut).startsWith('```gts\n'),
      'the next part starts with the whole block',
    );
  });

  test('a cut outside any block is left where it is', (assert) => {
    let content =
      'Some text\n\n' + block + '\n\nAnd more text after the block.';
    let proposed = content.length - 5;
    assert.strictEqual(cutOutsideCodeBlocks(content, 0, proposed), proposed);
  });

  test('a block larger than one event is still cut', (assert) => {
    let content = block; // the open block is the whole piece
    let proposed = 40;
    assert.strictEqual(cutOutsideCodeBlocks(content, 0, proposed), proposed);
  });

  test('the next message picks up from the moved cut', (assert) => {
    let intro = 'Intro text that fills some of the budget.\n';
    let content = intro + block + '\nDone.';
    let eventData = new ResponseEventData('$first', intro.length + 30);
    let first = eventData.reasoningAndContentForNextMessage('', content);
    assert.strictEqual(
      first.content,
      intro,
      'first event stops before the block',
    );
    eventData.updateEndIndices(first);
    let next = eventData.buildNextEvent();
    let second = next.reasoningAndContentForNextMessage('', content);
    assert.ok(
      second.content.startsWith('```gts\n'),
      'the block opens the second event',
    );
  });
});
