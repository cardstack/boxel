import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { PgAdapter } from '@cardstack/postgres';
import { param, type Expression } from '@cardstack/runtime-common';
import { setupDB } from './helpers/index.ts';

const OPEN_INDEX = 'job_reservations_open_job_id_locked_until_idx';

module(basename(import.meta.filename), function (hooks) {
  let dbAdapter: PgAdapter;

  setupDB(hooks, {
    beforeEach: async (adapter) => {
      dbAdapter = adapter;
    },
  });

  // Every claim of a job asks for the open, unexpired reservations, and the
  // checks of whether one job is running ask the same for its `job_id`.
  // `job_reservations` keeps every reservation ever made, so each of these
  // must be answered from the partial index over the open ones, not from the
  // table.
  //
  // Asserted with sequential scans disabled, because on an empty table the
  // planner would choose one whatever indexes exist. Asserted by the index's
  // name rather than by the absence of a sequential scan: with them disabled,
  // the planner can still walk the primary key end to end, which is the same
  // full read. `SET LOCAL` reverts with the transaction, and `withConnection`
  // rolls back on a throw, so the pooled connection is returned clean either
  // way.
  async function plan(expression: Expression): Promise<string> {
    return await dbAdapter.withConnection(async (query) => {
      await query(['BEGIN']);
      await query(['SET LOCAL enable_seqscan = off']);
      let rows = await query(['EXPLAIN (FORMAT JSON)', ...expression]);
      await query(['COMMIT']);
      return JSON.stringify(rows);
    });
  }

  test('the open reservations a claim reads come from the open index', async function (assert) {
    let claimPlan = await plan([
      `SELECT * FROM job_reservations WHERE locked_until > NOW() AND completed_at IS NULL`,
    ]);
    assert.ok(
      claimPlan.includes(OPEN_INDEX),
      `the claim's open-reservation scan should use ${OPEN_INDEX}; got: ${claimPlan}`,
    );
  });

  test("one job's open reservation comes from the open index", async function (assert) {
    let jobPlan = await plan([
      `SELECT 1 FROM job_reservations r WHERE r.job_id =`,
      param(1),
      `AND r.locked_until > NOW() AND r.completed_at IS NULL`,
    ]);
    assert.ok(
      jobPlan.includes(OPEN_INDEX),
      `a job's open-reservation check should use ${OPEN_INDEX}; got: ${jobPlan}`,
    );
  });
});
