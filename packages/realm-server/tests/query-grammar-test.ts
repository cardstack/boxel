import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename, join } from 'path';
import { readFileSync } from 'fs';

import {
  QUERY_GRAMMAR,
  grammarDescription,
  grammarHints,
  grammarMembers,
  isEngineForm,
  isWire,
  newerSpellingMarkers,
  type GrammarScopeName,
} from '@cardstack/runtime-common/query-grammar';

// The grammar table (runtime-common/query-grammar.ts) is read by the
// validator (query.ts), the spelling detection (query-syntax.ts) and the AI
// assistant's query schema (helpers/ai.ts). A list's order is part of a
// refusal's message (the nearest name wins ties by order; with none near,
// the whole list is printed), so the lists each consumer derives are pinned
// here as they read before the table existed.

const QUERY_MEMBERS = [
  'filter',
  'sort',
  'page',
  'facets',
  'collapse',
  'let',
  'explain',
  'rerank',
  'timeZone',
  'asData',
  'fields',
];

module(basename(import.meta.filename), function () {
  test('the validator reads the lists it always read', function (assert) {
    assert.deepEqual(grammarMembers('query', isEngineForm), QUERY_MEMBERS);
    assert.deepEqual(grammarMembers('query', isWire), [
      'realm',
      'realms',
      'queryString',
    ]);
    assert.deepEqual(
      grammarHints('query', (m) => m.form !== 'entry'),
      [
        ...QUERY_MEMBERS.filter((m) => m !== 'rerank'),
        'type',
        'realm',
        'realms',
        'queryString',
      ],
      'an unknown top-level member is matched against these',
    );
    assert.deepEqual(grammarMembers('page'), [
      'size',
      'number',
      'generation',
      'exactTotal',
      'total',
    ]);
    assert.deepEqual(
      grammarMembers('filter', (m) => m.role === 'modifier'),
      [
        'on',
        'type',
        'fields',
        'within',
        'prefix',
        'typos',
        'scope',
        'typoQuery',
        'typoPartial',
        'wordStatistics',
      ],
    );
    assert.deepEqual(grammarHints('filter'), [
      'eq',
      'in',
      'range',
      'contains',
      'matches',
      'near',
      'pattern',
      'regex',
      'linkedFrom',
      'every',
      'any',
      'not',
      'exists',
      'missing',
      'on',
      'type',
      'fields',
      'within',
      'prefix',
      'typos',
      'scope',
    ]);
    assert.deepEqual(grammarHints('sortEntry'), [
      'by',
      'on',
      'direction',
      'missing',
      'weight',
      'near',
      'blend',
      'expression',
      'boost',
      'relevance',
      'placement',
    ]);
    assert.deepEqual(grammarMembers('blend'), [
      'blend',
      'method',
      'k',
      'direction',
    ]);
    assert.deepEqual(grammarMembers('window'), [
      'expression',
      'top',
      'direction',
      'compare',
    ]);
    assert.deepEqual(grammarMembers('compare'), [
      'filter',
      'by',
      'near',
      'k',
      'minSimilarity',
    ]);
    assert.deepEqual(grammarMembers('facet'), [
      'by',
      'size',
      'own',
      'stats',
      'ranges',
      'interval',
      'prefix',
      'missing',
      'order',
      'measure',
    ]);
    assert.deepEqual(grammarMembers('facetRange'), ['from', 'to', 'key']);
    assert.deepEqual(grammarMembers('collapse'), ['by', 'on', 'keep']);
    assert.deepEqual(grammarMembers('binding'), ['from', 'select', 'one']);
    assert.deepEqual(grammarMembers('bindingQuery'), [
      'type',
      'filter',
      'sort',
      'page',
      'timeZone',
    ]);
    assert.deepEqual(grammarMembers('logBinding'), [
      'log',
      'logs',
      'filter',
      'select',
    ]);
    assert.deepEqual(grammarMembers('linkedFrom'), ['card', 'field']);
    assert.deepEqual(grammarMembers('nearTarget'), ['to', 'minSimilarity']);
    assert.deepEqual(grammarMembers('rangeBound'), ['gt', 'gte', 'lt', 'lte']);
  });

  test('the newer spelling is marked by the members it always was', function (assert) {
    assert.deepEqual(
      newerSpellingMarkers('query').filter((k) => k !== 'type'),
      ['facets', 'collapse', 'let', 'explain', 'timeZone', 'select'],
      'top level, in the order a mixed-spelling refusal names them',
    );
    assert.deepEqual(newerSpellingMarkers('page'), ['total', 'exactTotal']);
    assert.deepEqual([...newerSpellingMarkers('filter')].sort(), [
      'exists',
      'fields',
      'linkedFrom',
      'missing',
      'near',
      'pattern',
      'prefix',
      'regex',
      'scope',
      'typos',
      'within',
    ]);
    assert.deepEqual(
      [...newerSpellingMarkers('sortEntry')].sort(),
      ['blend', 'boost', 'expression', 'relevance'],
      'a sort entry’s near and missing are not markers',
    );
  });

  test('every refusal code the table names is a documented code', function (assert) {
    let documented = readFileSync(
      join(
        import.meta.dirname,
        '..',
        '..',
        'runtime-common',
        'invalid-query-error.ts',
      ),
      'utf8',
    );
    for (let [scope, { members }] of Object.entries(QUERY_GRAMMAR)) {
      for (let member of members as readonly {
        name: string;
        refusals?: readonly string[];
      }[]) {
        for (let code of member.refusals ?? []) {
          assert.ok(
            documented.includes(code),
            `${scope}.${member.name}: ${code} is documented`,
          );
        }
      }
    }
  });

  test('the AI schema describes members the grammar has', function (assert) {
    let described: [GrammarScopeName, string][] = [];
    for (let [scope, { members }] of Object.entries(QUERY_GRAMMAR)) {
      for (let member of members as readonly {
        name: string;
        description?: string;
      }[]) {
        if (member.description) {
          described.push([scope as GrammarScopeName, member.name]);
        }
      }
    }
    assert.ok(described.length > 30, `${described.length} members described`);
    for (let [scope, name] of described) {
      assert.strictEqual(
        typeof grammarDescription(scope, name),
        'string',
        `${scope}.${name}`,
      );
    }
    assert.throws(
      () => grammarDescription('filter', 'typoQuery'),
      /no description/,
      'an engine annotation is never described to the model',
    );
  });
});
