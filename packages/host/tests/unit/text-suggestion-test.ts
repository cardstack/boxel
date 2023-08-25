import { module, test } from 'qunit';
import {
  suggestCardChooserTitle,
  getSuggestionWithLowestDepth,
} from '@cardstack/host/utils/text-suggestion';

module('Unit | text-suggestion | card-chooser-title', function () {
  test('filter on', function (assert) {
    let filter = {
      on: { module: `https://my.realm/booking`, name: 'Booking' },
      eq: { 'hosts.firstName': 'Arthur' },
    };
    let suggestions = suggestCardChooserTitle(filter);
    assert.deepEqual(suggestions, [
      {
        depth: 0,
        suggestion: 'Choose a Booking card',
      },
    ]);
  });
  test('filter by type', function (assert) {
    let filter = {
      type: { module: `https://my.realm/booking`, name: 'Booking' },
    };
    let suggestions = suggestCardChooserTitle(filter);
    assert.deepEqual(suggestions, [
      {
        depth: 0,
        suggestion: 'Choose a Booking card',
      },
    ]);
  });
  test('filter by every', function (assert) {
    let filter = {
      every: [
        {
          on: { module: `https://my.realm/article`, name: 'Article' },
          eq: { 'author.firstName': 'Kafka' },
        },
        {
          on: { module: `https://my.realm/book`, name: 'Book' },
          eq: { 'author.firstName': 'Kafka' },
        },
      ],
    };
    let suggestions = suggestCardChooserTitle(filter);
    assert.deepEqual(suggestions, [
      {
        depth: 1,
        suggestion: 'Choose an Article card',
      },
      {
        depth: 1,
        suggestion: 'Choose a Book card',
      },
    ]);
  });

  test('filter by any', function (assert) {
    let filter = {
      any: [
        {
          on: { module: `https://my.realm/article`, name: 'Article' },
          eq: { 'author.firstName': 'Kafka' },
        },
        {
          on: { module: `https://my.realm/book`, name: 'Book' },
          eq: { 'author.firstName': 'Kafka' },
        },
      ],
    };
    let suggestions = suggestCardChooserTitle(filter);
    assert.deepEqual(suggestions, []);
  });
  test('filter with every with type and on', function (assert) {
    let filter = {
      every: [
        { type: { module: `https://my.realm/booking`, name: 'Booking' } },
        {
          on: { module: `https://my.realm/article`, name: 'Article' },
          eq: { 'author.firstName': 'Kafka' },
        },
        {
          on: { module: `https://my.realm/book`, name: 'Book' },
          eq: { 'author.firstName': 'Kafka' },
        },
      ],
    };
    let suggestions = suggestCardChooserTitle(filter);
    assert.deepEqual(suggestions, [
      {
        depth: 1,
        suggestion: 'Choose a Booking card',
      },
      {
        depth: 1,
        suggestion: 'Choose an Article card',
      },
      {
        depth: 1,
        suggestion: 'Choose a Book card',
      },
    ]);
  });

  test('filter by not', function (assert) {
    let filter = {
      on: { module: `https://my.realm/article`, name: 'Article' },
      not: { eq: { 'author.firstName': 'Carl' } },
    };
    let suggestions = suggestCardChooserTitle(filter);
    assert.deepEqual(suggestions, [
      {
        depth: 0,
        suggestion: 'Choose an Article card',
      },
    ]);
  });
  test('filter by range', function (assert) {
    let filter = {
      on: { module: `https://my.realm/post`, name: 'Post' },
      range: { views: { lte: 10, gt: 5 }, 'author.posts': { gte: 1 } },
    };
    let suggestions = suggestCardChooserTitle(filter);
    assert.deepEqual(suggestions, [
      {
        depth: 0,
        suggestion: 'Choose a Post card',
      },
    ]);
  });
  test('filter by card instance', function (assert) {
    let filter = {
      type: { module: `https://my.realm/cards-api`, name: 'CardDef' },
    };
    let suggestions = suggestCardChooserTitle(filter);
    assert.deepEqual(suggestions, [
      {
        depth: 0,
        suggestion: 'Choose a Card instance',
      },
    ]);
  });
  test('filter -- a complex one', function (assert) {
    let filter = {
      every: [
        {
          on: {
            module: `https://my.realm/post`,
            name: 'Post',
          },
        },
        { eq: { title: 'Card 1' } },
        { not: { eq: { 'author.firstName': 'Cardy' } } },
      ],
      type: { module: `https://my.realm/cards-api`, name: 'CardDef' },
    };
    let suggestions = suggestCardChooserTitle(filter);
    assert.deepEqual(suggestions, [
      {
        depth: 0,
        suggestion: 'Choose a Card instance',
      },
      {
        depth: 1,
        suggestion: 'Choose a Post card',
      },
    ]);
    assert.strictEqual(
      getSuggestionWithLowestDepth(suggestions),
      'Choose a Card instance',
    );
  });
  test('filter -- nested one that exceeds recursion depth', function (assert) {
    let filter = {
      every: [
        {
          type: { module: `https://my.realm/cards-api`, name: 'CardDef' },
        },
        {
          on: {
            module: `https://my.realm/post`,
            name: 'Post',
          },
          every: [
            {
              type: {
                module: `https://my.realm/some-type`,
                name: 'SomeCardType',
              },
            },
          ],
        },
      ],
    };
    let suggestions = suggestCardChooserTitle(filter);
    assert.deepEqual(suggestions, [
      {
        depth: 1,
        suggestion: 'Choose a Card instance',
      },
      {
        depth: 1,
        suggestion: 'Choose a Post card',
      },
    ]);
    assert.strictEqual(
      getSuggestionWithLowestDepth(suggestions),
      'Choose a Card instance',
    );
  });
  test('filter with on specifying multiSelect option', function (assert) {
    let filter = {
      on: { module: `https://my.realm/booking`, name: 'Booking' },
      eq: { 'hosts.firstName': 'Arthur' },
    };
    let suggestions = suggestCardChooserTitle(filter, 0, { multiSelect: true });
    assert.deepEqual(suggestions, [
      {
        depth: 0,
        suggestion: 'Select 1 or more Booking cards',
      },
    ]);
  });
  test('filter with on but checking for "an"', function (assert) {
    let filter = {
      on: { module: `https://my.realm/article`, name: 'Article' },
      eq: { 'author.firstName': 'Kafka' },
    };
    let suggestions = suggestCardChooserTitle(filter, 0);
    assert.deepEqual(suggestions, [
      {
        depth: 0,
        suggestion: 'Choose an Article card',
      },
    ]);
  });
});
