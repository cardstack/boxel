import { module, test } from 'qunit';

import { parseQuery, Query } from '@cardstack/runtime-common/query';
import qs from 'qs';

module('Unit | qs | parse', function () {
  test('parseQuery errors out if the query is too deep', async function (assert) {
    assert.throws(
      () => parseQuery('a[b][c][d][e][f][g][h][i][j][k][l]=m'),
      /RangeError: Input depth exceeded depth option of 10 and strictDepth is true/,
    );
  });
  test('invertibility: applying stringify and parse on object will return the same object', async function (assert) {
    let testRealmURL = 'https://example.com/';
    let query: Query = {
      filter: {
        on: {
          module: `${testRealmURL}book`,
          name: 'Book',
        },
        every: [
          {
            eq: {
              'author.firstName': 'Cardy',
            },
          },
          {
            any: [
              {
                eq: {
                  'author.lastName': 'Jones',
                },
              },
              {
                eq: {
                  'author.lastName': 'Stackington Jr. III',
                },
              },
            ],
          },
        ],
      },
      sort: [
        {
          by: 'author.lastName',
          on: { module: `${testRealmURL}book`, name: 'Book' },
        },
      ],
    };
    let queryString = qs.stringify(query);
    let parsedQuery: any = parseQuery(queryString);
    assert.deepEqual(parsedQuery, query);
  });
});
