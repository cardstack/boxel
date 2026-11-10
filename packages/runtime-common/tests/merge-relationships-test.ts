import { mergeRelationships } from '../merge-relationships.ts';
import type { SharedTests } from '../helpers/index.ts';

const storedFriends = {
  'friends.0': { links: { self: './jade' } },
  'friends.1': { links: { self: './hassan' } },
};

const tests = Object.freeze({
  'an empty relationship replaces a stored linksToMany': async (assert) => {
    assert.deepEqual(
      mergeRelationships(storedFriends, {
        friends: { links: { self: null } },
      }),
      { friends: { links: { self: null } } },
      '{ links: { self: null } }',
    );
    assert.deepEqual(
      mergeRelationships(storedFriends, { friends: { data: [] } }),
      { friends: { links: { self: null } } },
      '{ data: [] }',
    );
    assert.deepEqual(
      mergeRelationships(storedFriends, { friends: [] }),
      { friends: { links: { self: null } } },
      'an empty array',
    );
  },

  'an indexed member or a query-backed relationship is left as it is': async (
    assert,
  ) => {
    assert.deepEqual(
      mergeRelationships(storedFriends, { 'friends.0': { data: [] } }),
      { 'friends.0': { data: [] } },
      'an indexed member',
    );
    let matches = {
      links: { self: null, search: 'http://test-realm/_search?q=x' },
      data: [],
      meta: { total: 0 },
    };
    assert.deepEqual(
      mergeRelationships({}, { matches }),
      { matches },
      'a query-backed relationship',
    );
  },

  'a cleared linksTo replaces the stored link whole': async (assert) => {
    assert.deepEqual(
      mergeRelationships(
        {
          friend: {
            links: { self: './jade' },
            data: { type: 'card', id: 'http://test-realm/jade' },
          },
        },
        { friend: { links: { self: null } } },
      ),
      { friend: { links: { self: null } } },
    );
  },

  'a list replaces a stored linksToMany': async (assert) => {
    assert.deepEqual(
      mergeRelationships(storedFriends, {
        friends: [{ links: { self: './mango' } }],
      }),
      { 'friends.0': { links: { self: './mango' } } },
      'an array of relationships',
    );
    let data = [{ type: 'card', id: 'http://test-realm/mango' }];
    assert.deepEqual(
      mergeRelationships(storedFriends, { friends: { data } }),
      { friends: { data } },
      '{ data: [...] }',
    );
  },

  'a field that changed between linksTo and linksToMany takes its new shape':
    async (assert) => {
      assert.deepEqual(
        mergeRelationships(
          { 'pet.0': { links: { self: './mango' } } },
          { pet: { links: { self: './rex' } } },
        ),
        { pet: { links: { self: './rex' } } },
        'linksToMany to linksTo',
      );
      assert.deepEqual(
        mergeRelationships(
          { pet: { links: { self: './mango' } } },
          { 'pet.0': { links: { self: './rex' } } },
        ),
        { 'pet.0': { links: { self: './rex' } } },
        'linksTo to linksToMany',
      );
    },

  'a relationship the patch leaves out is kept': async (assert) => {
    assert.deepEqual(
      mergeRelationships(
        { ...storedFriends, friend: { links: { self: './jade' } } },
        { friend: { links: { self: null } } },
      ),
      { ...storedFriends, friend: { links: { self: null } } },
    );
  },
} as SharedTests<{}>);

export default tests;
