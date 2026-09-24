import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { SuperTest, Test } from 'supertest';
import {
  Batch,
  Deferred,
  IndexWriter,
  Worker,
  rri,
  type LooseSingleCardDocument,
  type Prerenderer,
  type QueuePublisher,
  type Realm,
  type VirtualNetwork,
} from '@cardstack/runtime-common';
import { PgQueueRunner, type PgAdapter } from '@cardstack/postgres';
import {
  createJWT,
  getTestPrerenderer,
  realmSecretSeed,
  realmServerTestMatrix,
  setupPermissionedRealmCached,
  testCreatePrerenderAuth,
  testRealmServerMatrixUsername,
  withRealmPath,
  type RealmRequest,
} from './helpers/index.ts';
import {
  prerenderedHtmlRowFor,
  settlePrerenderHtmlJobs,
} from './helpers/indexing.ts';

// Two people editing one realm index side by side. Writer A edits a hub card
// whose pass fans out to its dependents; writer B saves a cheap leaf. B's
// save must not wait out A's pass, and whichever pass commits last must not
// leave stale rows behind — the index passes run in per-writer lanes, and
// commit-time validation reconciles two passes that touched the same card.
//
// Writer A's pass is held after its visits and before its commit, so B's
// save is known to run while A's pass is in flight and not merely before or
// after it. The queue runs three workers: A's pass, the prerender-html job it
// spawns (which waits on A's commit), and B's pass each hold one.

const WRITER_A = '@writer-a:localhost';
const WRITER_B = '@writer-b:localhost';

// How long B's save may take while A's pass is held. A cold leaf pass costs
// a few seconds; a save still pending at this point is waiting on A.
const LEAF_SAVE_BUDGET_MS = 60_000;

const studentGts = `
  import { contains, field, CardDef, Component } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";

  export class Student extends CardDef {
    @field name = contains(StringField);
    static isolated = class Isolated extends Component<typeof this> {
      <template><p class="student">{{@model.name}}</p></template>
    };
    static embedded = class Embedded extends Component<typeof this> {
      <template><span class="student">{{@model.name}}</span></template>
    };
  }
`;

const reportGts = `
  import { contains, field, linksTo, CardDef, Component } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  import { Student } from "./student";

  export class Report extends CardDef {
    @field title = contains(StringField);
    @field student = linksTo(Student);
    static isolated = class Isolated extends Component<typeof this> {
      <template><p class="report">{{@model.title}} for {{@model.student.name}}</p></template>
    };
  }
`;

function studentDoc(name: string): LooseSingleCardDocument {
  return {
    data: {
      type: 'card',
      attributes: { name },
      meta: { adoptsFrom: { module: rri('./student'), name: 'Student' } },
    },
  };
}

function reportDoc(title: string, studentId: string): LooseSingleCardDocument {
  return {
    data: {
      type: 'card',
      attributes: { title },
      relationships: { student: { links: { self: studentId } } },
      meta: { adoptsFrom: { module: rri('./report'), name: 'Report' } },
    },
  };
}

// Holds the commit of every incremental pass writer A initiated, after its
// visits and before `Batch.done` takes the realm's commit lock, until the
// test releases it. Identified from the job row rather than from its lane, so
// the hold means the same thing whichever lane the pass was published to.
function holdWriterPassesBeforeCommit(
  dbAdapter: PgAdapter,
  writer: string,
): { reached: Promise<void>; release: () => void; restore: () => void } {
  let original = Batch.prototype.done;
  let reached = new Deferred<void>();
  let gate = new Deferred<void>();
  Batch.prototype.done = async function (
    this: Batch,
    ...args: Parameters<Batch['done']>
  ) {
    let jobId = (this as unknown as { jobInfo?: { jobId: number } }).jobInfo
      ?.jobId;
    if (jobId !== undefined && jobId > 0) {
      let [row] = (await dbAdapter.execute(
        `SELECT job_type, initiated_by FROM jobs WHERE id = $1`,
        { bind: [jobId] },
      )) as { job_type: string; initiated_by: string[] | null }[];
      if (
        row?.job_type === 'incremental-index' &&
        row.initiated_by?.includes(writer)
      ) {
        reached.fulfill();
        await gate.promise;
      }
    }
    return await original.apply(this, args);
  };
  return {
    reached: reached.promise,
    release: () => gate.fulfill(),
    restore: () => {
      Batch.prototype.done = original;
    },
  };
}

async function indexJobsBy(
  dbAdapter: PgAdapter,
  realmURL: URL,
  writer: string,
): Promise<
  {
    id: number;
    status: string;
    concurrency_group: string;
    lane_family: string | null;
    generation: number | null;
  }[]
> {
  return (await dbAdapter.execute(
    `SELECT id, status, concurrency_group, lane_family,
            (result->>'generation')::int AS generation
       FROM jobs
      WHERE job_type = 'incremental-index'
        AND (concurrency_group = $1 OR lane_family = $1)
        AND initiated_by @> $2::jsonb
      ORDER BY id`,
    {
      bind: [`indexing:${realmURL.href}`, JSON.stringify([writer])],
    },
  )) as {
    id: number;
    status: string;
    concurrency_group: string;
    lane_family: string | null;
    generation: number | null;
  }[];
}

async function indexRow(
  dbAdapter: PgAdapter,
  url: string,
): Promise<
  | {
      generation: number;
      pristine_doc: { attributes?: Record<string, unknown> } | null;
    }
  | undefined
> {
  let [row] = (await dbAdapter.execute(
    `SELECT generation, pristine_doc FROM boxel_index
      WHERE url = $1 AND type = 'instance'`,
    { bind: [url] },
  )) as {
    generation: number;
    pristine_doc: { attributes?: Record<string, unknown> } | null;
  }[];
  return row === undefined
    ? undefined
    : { ...row, generation: Number(row.generation) };
}

module(basename(import.meta.filename), function () {
  module('writers in their own index lanes', function (hooks) {
    let realmURL = new URL('http://127.0.0.1:4452/concurrent-writers/');
    let realm: Realm;
    let request: RealmRequest;
    let dbAdapter: PgAdapter;
    let publisher: QueuePublisher;
    let virtualNetwork: VirtualNetwork;

    setupPermissionedRealmCached(hooks, {
      mode: 'beforeEach',
      realmURL,
      permissions: {
        '*': ['read'],
        [WRITER_A]: ['read', 'write'],
        [WRITER_B]: ['read', 'write'],
        '@node-test_realm:localhost': ['read', 'realm-owner'],
      },
      fileSystem: {
        'student.gts': studentGts,
        'report.gts': reportGts,
        'student-1.json': studentDoc('Mango'),
        'report-1.json': reportDoc('Reading log', rri('./student-1')),
        'report-2.json': reportDoc('Spelling test', rri('./student-1')),
      },
      onRealmSetup(args: {
        testRealm: Realm;
        request: SuperTest<Test>;
        dbAdapter: PgAdapter;
        publisher: QueuePublisher;
        virtualNetwork: VirtualNetwork;
      }) {
        realm = args.testRealm;
        request = withRealmPath(args.request, realmURL);
        dbAdapter = args.dbAdapter;
        publisher = args.publisher;
        virtualNetwork = args.virtualNetwork;
      },
    });

    // Nested so the extra workers start after the realm fixture and stop
    // before it is torn down.
    module('with three workers', function (hooks) {
      let runners: PgQueueRunner[] = [];
      let hold: ReturnType<typeof holdWriterPassesBeforeCommit> | undefined;

      hooks.beforeEach(async function () {
        let prerenderer: Prerenderer = await getTestPrerenderer();
        for (let n of [2, 3]) {
          let runner = new PgQueueRunner({
            adapter: dbAdapter,
            workerId: `concurrent-writer-worker-${n}`,
          });
          runners.push(runner);
          let worker = new Worker({
            indexWriter: new IndexWriter(dbAdapter),
            queue: runner,
            dbAdapter,
            queuePublisher: publisher,
            virtualNetwork,
            matrixURL: realmServerTestMatrix.url,
            secretSeed: realmSecretSeed,
            realmServerMatrixUsername: testRealmServerMatrixUsername,
            prerenderer,
            createPrerenderAuth: testCreatePrerenderAuth,
          });
          await worker.run();
        }
      });

      hooks.afterEach(async function () {
        hold?.release();
        hold?.restore();
        hold = undefined;
        for (let runner of runners) {
          await runner.destroy();
        }
        runners = [];
      });

      function saveAs(
        writer: string,
        method: 'patch' | 'post',
        path: string,
        doc: unknown,
      ) {
        return request[method](path)
          .send(doc as object)
          .set('Accept', 'application/vnd.card+json')
          .set(
            'Authorization',
            `Bearer ${createJWT(realm, writer, ['read', 'write'])}`,
          );
      }

      // Starts writer A's hub edit and waits for its pass to be held before
      // its commit. Returns the pending response.
      async function startHeldHubEdit() {
        hold = holdWriterPassesBeforeCommit(dbAdapter, WRITER_A);
        let hubEdit = saveAs(
          WRITER_A,
          'patch',
          '/student-1',
          studentDoc('Mango Abdel-Rahman'),
        ).then((response) => response);
        await hold.reached;
        return hubEdit;
      }

      // Resolves with B's response, or with `undefined` once the budget
      // passes while A's pass is still held.
      async function leafSaveWithinBudget(
        save: Promise<{ status: number; text: string }>,
      ) {
        let timer: NodeJS.Timeout | undefined;
        let outOfBudget = new Promise<undefined>((resolve) => {
          timer = setTimeout(() => resolve(undefined), LEAF_SAVE_BUDGET_MS);
        });
        try {
          return await Promise.race([save, outOfBudget]);
        } finally {
          clearTimeout(timer);
        }
      }

      test("a leaf save commits while another writer's hub pass is in flight", async function (assert) {
        assert.timeout(240_000);
        let hubEdit = await startHeldHubEdit();

        let leafSave = leafSaveWithinBudget(
          saveAs(
            WRITER_B,
            'post',
            '/',
            reportDoc('Math quiz', rri('./student-1')),
          ).then((response) => response),
        );
        let leafResponse = await leafSave;
        assert.ok(
          leafResponse,
          `writer B's save completed while writer A's pass was held (budget ${LEAF_SAVE_BUDGET_MS} ms)`,
        );
        assert.strictEqual(
          leafResponse?.status,
          201,
          `writer B's save succeeded: ${leafResponse?.text}`,
        );

        let [leafPass] = await indexJobsBy(dbAdapter, realmURL, WRITER_B);
        let [hubPass] = await indexJobsBy(dbAdapter, realmURL, WRITER_A);
        assert.strictEqual(
          leafPass?.status,
          'resolved',
          "writer B's pass committed",
        );
        assert.strictEqual(
          hubPass?.status,
          'unfulfilled',
          "writer A's pass was still in flight when it did",
        );
        assert.notStrictEqual(
          leafPass?.concurrency_group,
          hubPass?.concurrency_group,
          'the two passes ran in different lanes',
        );
        assert.strictEqual(
          leafPass?.lane_family,
          `indexing:${realmURL.href}`,
          "writer B's lane belongs to the realm's index family",
        );

        hold!.release();
        let hubResponse = await hubEdit;
        assert.strictEqual(
          hubResponse.status,
          200,
          `writer A's save succeeded: ${hubResponse.text}`,
        );
        [hubPass] = await indexJobsBy(dbAdapter, realmURL, WRITER_A);
        assert.strictEqual(hubPass?.status, 'resolved', "A's pass committed");
        assert.ok(
          hubPass!.generation! > leafPass!.generation!,
          `writer A committed after writer B, at a higher generation (${hubPass?.generation} > ${leafPass?.generation})`,
        );
      });

      test('when the two passes touch the same card, the last to commit leaves it fresh', async function (assert) {
        assert.timeout(240_000);
        let report1 = `${realmURL.href}report-1.json`;
        let hubEdit = await startHeldHubEdit();

        // Writer A's pass has already visited report-1, a dependent of the
        // hub, against the bytes it had before this save.
        let leafResponse = await leafSaveWithinBudget(
          saveAs(
            WRITER_B,
            'patch',
            '/report-1',
            reportDoc('Reading log, week 2', rri('./student-1')),
          ).then((response) => response),
        );
        assert.ok(
          leafResponse,
          `writer B's save completed while writer A's pass was held (budget ${LEAF_SAVE_BUDGET_MS} ms)`,
        );
        assert.strictEqual(
          leafResponse?.status,
          200,
          `writer B's save succeeded: ${leafResponse?.text}`,
        );
        let [leafPass] = await indexJobsBy(dbAdapter, realmURL, WRITER_B);
        assert.strictEqual(
          leafPass?.status,
          'resolved',
          "writer B's pass committed",
        );

        hold!.release();
        let hubResponse = await hubEdit;
        assert.strictEqual(
          hubResponse.status,
          200,
          `writer A's save succeeded: ${hubResponse.text}`,
        );
        let [hubPass] = await indexJobsBy(dbAdapter, realmURL, WRITER_A);
        assert.ok(
          hubPass!.generation! > leafPass!.generation!,
          `writer A committed after writer B, at a higher generation (${hubPass?.generation} > ${leafPass?.generation})`,
        );

        let row = await indexRow(dbAdapter, report1);
        assert.strictEqual(
          row?.pristine_doc?.attributes?.title,
          'Reading log, week 2',
          "report-1's index row carries writer B's edit, although writer A committed last",
        );

        // Every render either pass owes was enqueued before its save
        // answered, so once the family settles the HTML is final.
        await settlePrerenderHtmlJobs(dbAdapter, realmURL, {
          timeout: 60_000,
        });
        let html = (await prerenderedHtmlRowFor(dbAdapter, report1))
          ?.isolated_html;
        assert.true(
          html?.includes('Reading log, week 2'),
          `report-1's HTML carries writer B's title: ${html}`,
        );
        assert.true(
          html?.includes('Mango Abdel-Rahman'),
          `report-1's HTML carries writer A's student name: ${html}`,
        );
      });
    });
  });
});
