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
import { PostgresChangeJournal } from '@cardstack/postgres';
import { setupPermissionedRealmCached } from './helpers/index.ts';

const REALM_URL = 'http://127.0.0.1:4444/test/';
const AUTOMATION = rri(`${REALM_URL}Automation/nightly-sync`);
const OTHER_AUTOMATION = rri(`${REALM_URL}Automation/weekly-report`);
const RUN: AutomationRunWrite = {
  runId: '0b9f1a52-6c43-4c0e-8f1d-3f6a9d6c1e01',
  automationId: AUTOMATION,
};
const OTHER_RUN: AutomationRunWrite = {
  runId: '7c2e4d18-1f0a-4b5e-9a3c-2d8e6f4b1a02',
  automationId: OTHER_AUTOMATION,
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

// The realm records the files in the transaction that writes their file
// meta. A server realm has a change journal and writes them on the journal's
// transaction; with history switched off it opens one of its own. Both paths
// run every test.
const SETUPS = [
  { name: 'a realm with a change journal', journal: true },
  { name: 'a realm with history switched off', journal: false },
];

module(basename(import.meta.filename), function () {
  for (let setup of SETUPS) {
    module(setup.name, function (hooks) {
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
        ...(setup.journal
          ? { history: { journal: new PostgresChangeJournal() } }
          : {}),
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

      async function indexBytes(
        path: string,
        types?: string[],
      ): Promise<number> {
        let [{ bytes }] = (await dbAdapter.execute(
          `SELECT
             (SELECT COALESCE(SUM(pg_column_size(i.*)), 0) FROM boxel_index i
              WHERE i.url = $1 AND ($2::text[] IS NULL OR i.type = ANY($2::text[])))
             + (SELECT COALESCE(SUM(pg_column_size(h.*)), 0) FROM prerendered_html h
              WHERE h.url = $1 AND ($2::text[] IS NULL OR h.type = ANY($2::text[])))
             AS bytes`,
          { bind: [`${REALM_URL}${path}`, types ?? null] },
        )) as { bytes: string }[];
        return Number(bytes);
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
          new Map<LocalPath, string>([
            ['people/existing.json', person('Changed')],
          ]),
          { automationRun: RUN },
        );
        assert.deepEqual(await recordedPaths(), []);
      });

      test('a write made for no run records nothing', async function (assert) {
        await realm.write('people/manual.json', person('Manual'));
        assert.deepEqual(await recordedPaths(), []);
      });

      test('a file another run only changes keeps the automation that created it', async function (assert) {
        await realm.write('logs/sync.jsonl', '{"synced":1}\n', {
          automationRun: RUN,
        });
        await realm.write('logs/sync.jsonl', '{"synced":2}\n', {
          automationRun: OTHER_RUN,
        });
        assert.deepEqual(await recordedPaths(), [
          `logs/sync.jsonl ${AUTOMATION} ${RUN.runId}`,
        ]);
      });

      test("a file created where a stale row survives is not the stale row's automation's", async function (assert) {
        let stale = async (path: string) =>
          await dbAdapter.execute(
            `INSERT INTO automation_files (realm_url, file_path, automation_id, run_id) VALUES ($1, $2, $3, $4)`,
            { bind: [REALM_URL, path, AUTOMATION, RUN.runId] },
          );
        await stale('logs/by-a-person.jsonl');
        await stale('logs/by-another-run.jsonl');

        await realm.write('logs/by-a-person.jsonl', '{"synced":1}\n');
        await realm.write('logs/by-another-run.jsonl', '{"synced":1}\n', {
          automationRun: OTHER_RUN,
        });

        assert.deepEqual(await recordedPaths(), [
          `logs/by-another-run.jsonl ${OTHER_AUTOMATION} ${OTHER_RUN.runId}`,
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

      test("an automation's storage is its files' sizes and every index row they cause", async function (assert) {
        let log = '{"synced":1}\n';
        await realm.writeMany(
          new Map<LocalPath, string>([
            ['people/new.json', person('New')],
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
        let logIndexBytes = await indexBytes('logs/sync.jsonl');
        assert.ok(logIndexBytes > 0, 'the log has its own file rows');
        assert.strictEqual(
          byPath.get('logs/sync.jsonl')?.indexBytes,
          logIndexBytes,
          "the log's index rows",
        );
        let cardIndexBytes = await indexBytes('people/new.json');
        assert.ok(
          cardIndexBytes > (await indexBytes('people/new.json', ['instance'])),
          'the card has a file row beside its instance row',
        );
        assert.strictEqual(
          byPath.get('people/new.json')?.indexBytes,
          cardIndexBytes,
          "the card's index rows, of every type",
        );
        assert.strictEqual(
          storage.fileBytes,
          byPath.get('people/new.json')!.fileBytes + Buffer.byteLength(log),
        );
        assert.strictEqual(storage.indexBytes, logIndexBytes + cardIndexBytes);
        assert.deepEqual(
          (await getAutomationStorage(dbAdapter, OTHER_AUTOMATION)).files,
          [],
          "another automation's storage holds none of them",
        );
      });
    });
  }
});
