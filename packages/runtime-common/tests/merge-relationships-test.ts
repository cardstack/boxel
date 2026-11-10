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
      { friends: { data: [] } },
      '{ data: [] }',
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
