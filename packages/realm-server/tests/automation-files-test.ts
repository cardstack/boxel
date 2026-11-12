import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import {
  getAutomationStorage,
  rri,
  type AutomationRunWrite,
  type DBAdapter,
  type LocalPath,
  type Realm,
} from '@cardstack/runtime-common';
import { setupPermissionedRealmCached } from './helpers/index.ts';

const REALM_URL = 'http://127.0.0.1:4444/test/';
const AUTOMATION = rri(`${REALM_URL}Automation/nightly-sync`);
const OTHER_AUTOMATION = rri(`${REALM_URL}Automation/weekly-report`);
const RUN: AutomationRunWrite = {
  runId: '0b9f1a52-6c43-4c0e-8f1d-3f6a9d6c1e01',
  automationId: AUTOMATION,
};

const PERSON_MODULE = `
  import { contains, field, CardDef } from 'https://cardstack.com/base/card-api';
  import StringField from 'https://cardstack.com/base/string';
  export class Person extends CardDef {
    @field firstName = contains(StringField);
  }
`;

function person(firstName: string): string {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes: { firstName },
      meta: { adoptsFrom: { module: '../person', name: 'Person' } },
    },
  });
}

module(basename(import.meta.filename), function (hooks) {
  let realm: Realm;
  let dbAdapter: DBAdapter;

  setupPermissionedRealmCached(hooks, {
    realmURL: new URL(REALM_URL),
    permissions: {
      '@node-test_realm:localhost': ['read', 'write', 'realm-owner'],
    },
    fileSystem: {
      'person.gts': PERSON_MODULE,
      'people/existing.json': person('Existing'),
    },
    onRealmSetup: (args) => {
      realm = args.testRealm;
      dbAdapter = args.dbAdapter;
    },
  });

  async function recordedPaths(): Promise<string[]> {
    let rows = await dbAdapter.execute(
      `SELECT file_path, automation_id, run_id FROM automation_files ORDER BY file_path`,
    );
    return rows.map(
      (row) => `${row.file_path} ${row.automation_id} ${row.run_id}`,
    );
  }

  test("a run's commit records the files it created as its automation's", async function (assert) {
    await realm.writeMany(
      new Map<LocalPath, string>([
        ['people/new.json', person('New')],
        ['logs/sync.jsonl', '{"synced":1}\n'],
      ]),
      { automationRun: RUN },
    );
    assert.deepEqual(await recordedPaths(), [
      `logs/sync.jsonl ${AUTOMATION} ${RUN.runId}`,
      `people/new.json ${AUTOMATION} ${RUN.runId}`,
    ]);
  });

  test('a file the run only changed is not recorded', async function (assert) {
    await realm.writeMany(
      new Map<LocalPath, string>([['people/existing.json', person('Changed')]]),
      { automationRun: RUN },
    );
    assert.deepEqual(await recordedPaths(), []);
  });

  test('a write made for no run records nothing', async function (assert) {
    await realm.write('people/manual.json', person('Manual'));
    assert.deepEqual(await recordedPaths(), []);
  });

  test('a file keeps the automation that created it when another run changes it', async function (assert) {
    await realm.write('logs/sync.jsonl', '{"synced":1}\n', {
      automationRun: RUN,
    });
    await realm.write('logs/sync.jsonl', '{"synced":2}\n', {
      automationRun: {
        runId: '7c2e4d18-1f0a-4b5e-9a3c-2d8e6f4b1a02',
        automationId: OTHER_AUTOMATION,
      },
    });
    assert.deepEqual(await recordedPaths(), [
      `logs/sync.jsonl ${AUTOMATION} ${RUN.runId}`,
    ]);
  });

  test("a file a person deletes stops being the automation's", async function (assert) {
    await realm.writeMany(
      new Map<LocalPath, string>([
        ['people/new.json', person('New')],
        ['logs/sync.jsonl', '{"synced":1}\n'],
      ]),
      { automationRun: RUN },
    );
    await realm.delete('people/new.json');
    assert.deepEqual(await recordedPaths(), [
      `logs/sync.jsonl ${AUTOMATION} ${RUN.runId}`,
    ]);
    let storage = await getAutomationStorage(dbAdapter, AUTOMATION);
    assert.deepEqual(
      storage.files.map((file) => file.path),
      ['logs/sync.jsonl'],
    );
  });

  test("an automation's storage is its files' sizes, and its cards' index rows", async function (assert) {
    let log = '{"synced":1}\n';
    let card = person('New');
    await realm.writeMany(
      new Map<LocalPath, string>([
        ['people/new.json', card],
        ['logs/sync.jsonl', log],
      ]),
      { automationRun: RUN },
    );
    await realm.indexing();

    let storage = await getAutomationStorage(dbAdapter, AUTOMATION);
    let byPath = new Map(storage.files.map((file) => [file.path, file]));
    assert.strictEqual(
      byPath.get('logs/sync.jsonl')?.fileBytes,
      Buffer.byteLength(log),
      "the log's size on disk",
    );
    assert.strictEqual(
      byPath.get('logs/sync.jsonl')?.indexBytes,
      0,
      'a file that is not a card has no index rows',
    );
    let [{ bytes: expectedIndexBytes }] = (await dbAdapter.execute(
      `SELECT
         (SELECT COALESCE(SUM(pg_column_size(i.*)), 0) FROM boxel_index i
          WHERE i.url = $1 AND i.type = 'instance')
         + (SELECT COALESCE(SUM(pg_column_size(h.*)), 0) FROM prerendered_html h
          WHERE h.url = $1 AND h.type = 'instance') AS bytes`,
      { bind: [`${REALM_URL}people/new.json`] },
    )) as { bytes: string }[];
    assert.ok(Number(expectedIndexBytes) > 0, 'the card is indexed');
    assert.strictEqual(
      byPath.get('people/new.json')?.indexBytes,
      Number(expectedIndexBytes),
      "the card's index rows",
    );
    assert.strictEqual(
      storage.fileBytes,
      byPath.get('people/new.json')!.fileBytes + Buffer.byteLength(log),
    );
    assert.strictEqual(storage.indexBytes, Number(expectedIndexBytes));
    assert.deepEqual(
      (await getAutomationStorage(dbAdapter, OTHER_AUTOMATION)).files,
      [],
      "another automation's storage holds none of them",
    );
  });
});
