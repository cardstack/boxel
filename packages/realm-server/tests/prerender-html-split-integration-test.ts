import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import { rri } from '@cardstack/runtime-common';
import type { DBAdapter, Realm } from '@cardstack/runtime-common';
import { setupPermissionedRealmCached, waitUntil } from './helpers/index.ts';
import {
  currentRealmGeneration,
  prerenderedHtmlRowFor,
  settlePrerenderHtmlJobs,
} from './helpers/indexing.ts';

const testRealm = new URL('http://127.0.0.1:4445/test/');

function makeFileSystem() {
  return {
    'person.gts': `
      import { contains, field, CardDef, Component } from "https://cardstack.com/base/card-api";
      import StringField from "https://cardstack.com/base/string";
      import NumberField from "https://cardstack.com/base/number";

      export class Person extends CardDef {
        @field firstName = contains(StringField);
        @field hourlyRate = contains(NumberField);
        static isolated = class Isolated extends Component<typeof this> {
          <template>
            <h1><@fields.firstName /> \${{@model.hourlyRate}}</h1>
          </template>
        }
        static embedded = class Embedded extends Component<typeof this> {
          <template>
            <h1> Embedded Card Person: <@fields.firstName/></h1>
          </template>
        }
        static fitted = class Fitted extends Component<typeof this> {
          <template>
            <h1> Fitted Card Person: <@fields.firstName/></h1>
          </template>
        }
      }
    `,
    'mango.json': {
      data: {
        attributes: {
          firstName: 'Mango',
        },
        meta: {
          adoptsFrom: {
            module: rri('./person'),
            name: 'Person',
          },
        },
      },
    },
    'vangogh.json': {
      data: {
        attributes: {
          firstName: 'Van Gogh',
          hourlyRate: 50,
        },
        meta: {
          adoptsFrom: {
            module: rri('./person'),
            name: 'Person',
          },
        },
      },
    },
  };
}

function personDoc(firstName: string, hourlyRate: number) {
  return JSON.stringify({
    data: {
      attributes: { firstName, hourlyRate },
      meta: {
        adoptsFrom: {
          module: rri('./person'),
          name: 'Person',
        },
      },
    },
  });
}

module(basename(import.meta.filename), function (hooks) {
  let realm: Realm;
  let testDbAdapter: DBAdapter;

  setupPermissionedRealmCached(hooks, {
    mode: 'beforeEach',
    realmURL: testRealm,
    permissions: {
      '*': ['read'],
    },
    fileSystem: makeFileSystem(),
    onRealmSetup({ dbAdapter, testRealm: r }) {
      testDbAdapter = dbAdapter;
      realm = r;
    },
  });

  interface PrerenderHtmlJobRow {
    id: number;
    status: string;
    args: {
      generation: number;
      spawningJobId: number | null;
      changes: { url: string; operation: string }[];
    };
  }

  async function prerenderHtmlJobs(): Promise<PrerenderHtmlJobRow[]> {
    return (await testDbAdapter.execute(
      `select id, status, args from jobs where job_type = 'prerender_html' order by id`,
    )) as unknown as PrerenderHtmlJobRow[];
  }

  async function boxelIndexHtmlColumns(url: string) {
    let rows = (await testDbAdapter.execute(
      `select isolated_html, embedded_html, markdown, icon_html from boxel_index where url = $1 and type = 'instance'`,
      { bind: [url] },
    )) as {
      isolated_html: string | null;
      embedded_html: Record<string, string> | null;
      markdown: string | null;
      icon_html: string | null;
    }[];
    return rows[0];
  }

  test('the index pass writes no HTML into boxel_index; reads serve the prerendered_html channel', async function (assert) {
    let indexRow = await boxelIndexHtmlColumns(`${testRealm}mango.json`);
    assert.strictEqual(
      indexRow.isolated_html,
      null,
      'the index channel carries no isolated HTML',
    );
    assert.strictEqual(
      indexRow.embedded_html,
      null,
      'the index channel carries no embedded HTML',
    );
    assert.strictEqual(
      indexRow.markdown,
      null,
      'the index channel carries no markdown',
    );
    assert.ok(
      indexRow.icon_html,
      'the icon renders in the index visit and stays on boxel_index',
    );

    let generation = await currentRealmGeneration(testDbAdapter, realm.url);
    let htmlRow = await prerenderedHtmlRowFor(
      testDbAdapter,
      `${testRealm}mango.json`,
    );
    assert.ok(htmlRow, 'the prerender channel has the HTML row');
    assert.strictEqual(
      htmlRow!.generation,
      generation,
      'the HTML is stamped with the generation its index pass committed',
    );
    assert.ok(
      htmlRow!.isolated_html?.includes('Mango'),
      'the prerender channel carries the rendered HTML',
    );

    let entry = await realm.realmIndexQueryEngine.instance(
      new URL(`${testRealm}mango`),
    );
    assert.strictEqual(entry?.type, 'instance');
    if (entry?.type === 'instance') {
      assert.ok(
        entry.isolatedHtml?.includes('Mango'),
        'reads serve HTML from the prerendered_html channel',
      );
    }
  });

  test('a write publishes the prerender_html job while its index pass is still running, then HTML lands on its own channel', async function (assert) {
    let bootJobIds = new Set((await prerenderHtmlJobs()).map((j) => j.id));

    let writeDone = realm.write('mango.json', personDoc('Mango', 25));
    // The publish fires from within the index pass the moment its
    // invalidation set is fixed — observable while that pass still holds
    // its reservation.
    await waitUntil(
      async () => {
        let [htmlJobs, incrementalJobs] = await Promise.all([
          prerenderHtmlJobs(),
          testDbAdapter.execute(
            `select id, status from jobs where job_type = 'incremental-index'`,
          ) as Promise<{ id: number; status: string }[]>,
        ]);
        let published = htmlJobs.some((j) => !bootJobIds.has(j.id));
        let indexPassStillRunning = incrementalJobs.some(
          (j) => j.status === 'unfulfilled',
        );
        return published && indexPassStillRunning;
      },
      {
        timeout: 30000,
        interval: 25,
        timeoutMessage:
          'expected the prerender_html job to be published while its spawning index pass was still running',
      },
    );
    await writeDone;

    let generation = await currentRealmGeneration(testDbAdapter, realm.url);
    let spawned = (await prerenderHtmlJobs()).filter(
      (j) => !bootJobIds.has(j.id),
    );
    assert.strictEqual(
      spawned.length,
      1,
      'the write spawned exactly one prerender_html job',
    );
    let [job] = spawned;
    assert.strictEqual(
      job.args.generation,
      generation,
      'the job carries the generation its index pass committed',
    );
    assert.ok(
      job.args.changes.some(
        (change) =>
          change.url === `${testRealm}mango.json` &&
          change.operation === 'update',
      ),
      'the job carries the invalidated URL as an update',
    );

    await settlePrerenderHtmlJobs(testDbAdapter, realm.url);
    let htmlRow = await prerenderedHtmlRowFor(
      testDbAdapter,
      `${testRealm}mango.json`,
    );
    assert.strictEqual(
      htmlRow?.generation,
      generation,
      'the fresh HTML is stamped with the committed generation',
    );
    assert.ok(
      htmlRow?.isolated_html?.includes('$25'),
      `the fresh rendering reflects the written content: ${htmlRow?.isolated_html}`,
    );
    let indexRow = await boxelIndexHtmlColumns(`${testRealm}mango.json`);
    assert.strictEqual(
      indexRow.isolated_html,
      null,
      'the index channel still carries no HTML after the write',
    );
  });

  test('a deletion stays tombstoned on the prerendered_html channel', async function (assert) {
    await realm.delete('mango.json');

    let jobs = await prerenderHtmlJobs();
    let deleteJob = jobs[jobs.length - 1];
    assert.ok(
      deleteJob.args.changes.some(
        (change) =>
          change.url === `${testRealm}mango.json` &&
          change.operation === 'delete',
      ),
      'the job carries the deletion as an explicit delete operation',
    );

    await settlePrerenderHtmlJobs(testDbAdapter, realm.url);
    let htmlRow = await prerenderedHtmlRowFor(
      testDbAdapter,
      `${testRealm}mango.json`,
    );
    assert.true(Boolean(htmlRow?.is_deleted), 'the HTML row is tombstoned');
    assert.strictEqual(
      htmlRow?.generation,
      await currentRealmGeneration(testDbAdapter, realm.url),
      'the tombstone is stamped with the deleting generation',
    );
    let entry = await realm.realmIndexQueryEngine.instance(
      new URL(`${testRealm}mango`),
    );
    assert.strictEqual(entry, undefined, 'the instance is gone from reads');
  });

  test('sequential writes converge: each URL serves the generation its own index pass committed', async function (assert) {
    await realm.write('mango.json', personDoc('Mango', 30));
    await realm.write('vangogh.json', personDoc('Van Gogh', 60));
    await settlePrerenderHtmlJobs(testDbAdapter, realm.url);

    for (let [file, needle] of [
      ['mango.json', '$30'],
      ['vangogh.json', '$60'],
    ] as const) {
      let url = `${testRealm}${file}`;
      let [indexGeneration] = (await testDbAdapter.execute(
        `select generation from boxel_index where url = $1 and type = 'instance'`,
        { bind: [url] },
      )) as { generation: number }[];
      let htmlRow = await prerenderedHtmlRowFor(testDbAdapter, url);
      assert.strictEqual(
        htmlRow?.generation,
        indexGeneration.generation,
        `${file}'s HTML generation matches its index row's generation`,
      );
      assert.ok(
        htmlRow?.isolated_html?.includes(needle),
        `${file}'s HTML reflects its written content`,
      );
    }
  });
});
