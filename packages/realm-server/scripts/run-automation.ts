import '../instrument.ts';
import '../setup-logger.ts'; // This should be first
import { randomUUID } from 'crypto';
import { parseArgs } from 'util';
import {
  createAutomationRun,
  ensureTrailingSlash,
  getAutomationRun,
  ri,
  rri,
} from '@cardstack/runtime-common';
import { MAX_RUN_SECONDS } from '@cardstack/runtime-common/automation-declaration';
import { enqueueAutomationRunJob } from '@cardstack/runtime-common/jobs/run-command';
import { PgAdapter, PgQueuePublisher } from '@cardstack/postgres';

// Runs one automation by hand in development, as Run now does: creates a run
// row for the automation card, enqueues its job at the automation tier and
// waits for it, then prints the run row. A worker on the stack runs the job
// in a prerender tab. Pass `--preview` to stop before the commit.
//
//   pnpm run-automation --realm http://localhost:4201/user/my-realm/ \
//     --card http://localhost:4201/user/my-realm/automation/sync \
//     --as @user:localhost [--preview]
async function main() {
  let { values } = parseArgs({
    options: {
      realm: { type: 'string' },
      card: { type: 'string' },
      as: { type: 'string' },
      preview: { type: 'boolean', default: false },
    },
  });
  if (!values.realm || !values.card || !values.as) {
    console.error(
      'Usage: run-automation --realm <realm URL> --card <automation card URL> --as <@user:server> [--preview]',
    );
    process.exit(1);
  }
  let realmURL = ensureTrailingSlash(values.realm);
  let cardURL = values.card.replace(/\.json$/, '');
  let dbAdapter = new PgAdapter({});
  let queue = new PgQueuePublisher(dbAdapter);
  try {
    let run = await createAutomationRun(dbAdapter, {
      automationId: rri(cardURL),
      realm: ri(realmURL),
      trigger: 'manual',
      slot: randomUUID(),
      actsAs: values.as,
    });
    let job = await enqueueAutomationRunJob(queue, {
      automationId: run.automationId,
      realmURL,
      actsAs: run.actsAs,
      trigger: run.trigger,
      slot: run.slot,
      // The run itself is held to the card's `seconds` cap; the job only
      // needs to outlast it.
      secondsCap: MAX_RUN_SECONDS,
      input: {
        runId: run.id,
        scheduledAt: new Date().toISOString(),
        dryRun: values.preview,
        triggerKind: 'manual',
      },
    });
    console.log(`run ${run.id} enqueued as job ${job.id}; waiting for it…`);
    await job.done;
    console.log(
      JSON.stringify(await getAutomationRun(dbAdapter, run.id), null, 2),
    );
  } finally {
    await queue.destroy();
    await dbAdapter.close();
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
