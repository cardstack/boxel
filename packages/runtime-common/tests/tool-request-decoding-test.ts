import type { SharedTests } from '../helpers/index.ts';
import { decodeToolRequest } from '../commands.ts';

const tests = Object.freeze({
  'decodes an encoded request with stringified arguments': async (assert) => {
    assert.deepEqual(
      decodeToolRequest({
        id: 'tool-1',
        name: 'show-card_566f',
        arguments: JSON.stringify({
          description: 'show it',
          attributes: { cardId: 'https://realm/Card/1' },
        }),
      }),
      {
        id: 'tool-1',
        name: 'show-card_566f',
        arguments: {
          description: 'show it',
          attributes: { cardId: 'https://realm/Card/1' },
        },
      },
    );
  },

  'a partial (still-streaming) arguments string decodes without throwing, leaving arguments undefined':
    async (assert) => {
      let decoded = decodeToolRequest({
        id: 'tool-1',
        name: 'switch-submode_dd88',
        // A truncated stream of {"description":"Switch to code mode","attr…
        arguments: '{"description":"Switch to code mode","attr',
      });
      assert.strictEqual(decoded.id, 'tool-1');
      assert.strictEqual(decoded.name, 'switch-submode_dd88');
      assert.strictEqual(
        decoded.arguments,
        undefined,
        'unparseable arguments decode to undefined for validation to report, not a throw that breaks message building',
      );
    },

  'a doubly-encoded attributes string is decoded': async (assert) => {
    let decoded = decodeToolRequest({
      id: 'tool-1',
      name: 'show-card_566f',
      arguments: JSON.stringify({
        description: 'show it',
        attributes: JSON.stringify({ cardId: 'https://realm/Card/1' }),
      }),
    });
    assert.deepEqual(decoded.arguments?.attributes, {
      cardId: 'https://realm/Card/1',
    });
  },

  'malformed nested attributes keep the outer decode': async (assert) => {
    let decoded = decodeToolRequest({
      id: 'tool-1',
      name: 'show-card_566f',
      arguments: JSON.stringify({
        description: 'show it',
        attributes: '{not json',
      }),
    });
    assert.strictEqual(decoded.arguments?.description, 'show it');
    assert.strictEqual(
      decoded.arguments?.attributes,
      '{not json',
      'the outer parse survives; validation reports the malformed attributes',
    );
  },
} as SharedTests<{}>);

export default tests;
