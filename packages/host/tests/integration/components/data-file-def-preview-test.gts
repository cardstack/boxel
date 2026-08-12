import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm, type Loader } from '@cardstack/runtime-common';

import { setupBaseRealm } from '../../helpers/base-realm';
import { renderCard } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

import type * as CsvFileDefModule from '@cardstack/base/csv-file-def';
import type * as JsonFileDefModule from '@cardstack/base/json-file-def';

const JSON_SOURCE = JSON.stringify(
  {
    name: 'my-app',
    version: '1.0.0',
    dependencies: { lodash: '^4.17.21' },
  },
  null,
  2,
);

const CSV_SOURCE = [
  'name,age,city',
  'Alice,30,New York',
  'Bob,25,San Francisco',
].join('\n');

// JsonFileDef and CsvFileDef supply only a data `previewComponent`; the four
// shared shells own identity, facts, and state. These tests pin what is unique
// to the data family: a structured tree (JSON) / table (CSV) in the reading
// formats, and a count summary — not a cropped table — in a fitted cell.
module('Integration | json/csv file def preview', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);

  let loader: Loader;
  let JsonFileDef: typeof JsonFileDefModule.JsonFileDef;
  let CsvFileDef: typeof CsvFileDefModule.CsvFileDef;

  hooks.beforeEach(async function (this: RenderingTestContext) {
    loader = getService('loader-service').loader;
    JsonFileDef = (
      await loader.import<typeof JsonFileDefModule>(
        `${baseRealm.url}json-file-def`,
      )
    ).JsonFileDef;
    CsvFileDef = (
      await loader.import<typeof CsvFileDefModule>(
        `${baseRealm.url}csv-file-def`,
      )
    ).CsvFileDef;
  });

  function jsonFile() {
    return new JsonFileDef({
      id: 'http://example.com/data/config.json',
      url: 'http://example.com/data/config.json',
      sourceUrl: 'http://example.com/data/config.json',
      name: 'config.json',
      contentType: 'application/json',
      content: JSON_SOURCE,
      rootType: 'object',
      keyCount: 3,
    });
  }

  function csvFile() {
    return new CsvFileDef({
      id: 'http://example.com/data/people.csv',
      url: 'http://example.com/data/people.csv',
      sourceUrl: 'http://example.com/data/people.csv',
      name: 'people.csv',
      contentType: 'text/csv',
      content: CSV_SOURCE,
      columns: ['name', 'age', 'city'],
      columnCount: 3,
      rowCount: 2,
    });
  }

  for (let format of ['isolated', 'embedded'] as const) {
    test(`JSON renders a structured tree in the ${format} shell`, async function (assert) {
      await renderCard(loader, jsonFile(), format);
      assert.dom(`[data-test-file-${format}]`).exists();
      assert.dom('[data-test-json-preview] .jt-tree').exists('renders a tree');
      assert
        .dom('[data-test-json-preview] .jt-key')
        .exists('keys are marked in the tree');
      assert.dom('[data-test-json-preview]').containsText('dependencies');
    });

    test(`CSV renders a table in the ${format} shell`, async function (assert) {
      await renderCard(loader, csvFile(), format);
      assert.dom(`[data-test-file-${format}]`).exists();
      assert.dom('[data-test-csv-preview] table').exists('renders a table');
      assert.dom('[data-test-csv-preview] th').containsText('name');
      assert.dom('[data-test-csv-preview]').containsText('Alice');
    });
  }

  test('JSON fitted shows a key-count summary, not a tree', async function (assert) {
    await renderCard(loader, jsonFile(), 'fitted');
    assert.dom('[data-test-file-fitted]').exists();
    assert.dom('[data-test-json-preview] .jt-tree').doesNotExist();
    assert.dom('[data-test-json-preview] .data-summary').containsText('3');
    assert.dom('[data-test-json-preview] .data-summary').containsText('keys');
  });

  test('CSV fitted shows a row/column-count summary, not a table', async function (assert) {
    await renderCard(loader, csvFile(), 'fitted');
    assert.dom('[data-test-file-fitted]').exists();
    assert.dom('[data-test-csv-preview] table').doesNotExist();
    assert.dom('[data-test-csv-preview] .data-summary').containsText('rows');
    assert.dom('[data-test-csv-preview] .data-summary').containsText('cols');
  });

  test('invalid JSON falls back to raw text rather than an empty pane', async function (assert) {
    let file = new JsonFileDef({
      id: 'http://example.com/data/broken.json',
      url: 'http://example.com/data/broken.json',
      name: 'broken.json',
      contentType: 'application/json',
      content: '{ not valid json',
    });
    await renderCard(loader, file, 'isolated');
    assert.dom('[data-test-json-preview] .jt-tree').doesNotExist();
    assert.dom('[data-test-json-preview] .jt-raw').containsText('not valid');
  });

  test('the data shells label the recognized kind, not the base displayName', async function (assert) {
    await renderCard(loader, jsonFile(), 'fitted');
    assert.dom('[data-test-file-kind]').hasText('JSON');

    await renderCard(loader, csvFile(), 'fitted');
    assert.dom('[data-test-file-kind]').hasText('CSV data');
  });
});
