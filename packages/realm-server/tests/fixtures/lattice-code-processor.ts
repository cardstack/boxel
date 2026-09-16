import { PgAdapter, PgQueueRunner } from '@cardstack/postgres';
import { VirtualNetwork } from '@cardstack/runtime-common';
import { LatticeRealmConfig } from '@cardstack/runtime-common/lattice-config';
import { LATTICE_CODE_JOB_TYPE } from '@cardstack/runtime-common/jobs/lattice-code';
import { createLatticeCodeWorker } from '../../lib/lattice-code-worker.ts';
import type { LatticeNativeRealmPolicy } from '../../lib/lattice-postgres-admission.ts';

// Real child/queue boundary for the integration test. No file or Chrome loader.
process.once('message', async (policy: LatticeNativeRealmPolicy) => {
  const db = new PgAdapter({ autoMigrate: false });
  const queue = new PgQueueRunner({
    adapter: db,
    workerId: `lattice-code-test-${process.pid}`,
    priority: 0,
    lattice: new LatticeRealmConfig([policy.realmURL]),
  });
  process.on('message', async (message) => {
    if (message === 'stop') {
      await queue.destroy();
      await db.close();
      process.disconnect();
    }
  });
  await queue.register(
    LATTICE_CODE_JOB_TYPE,
    createLatticeCodeWorker({
      db,
      network: new VirtualNetwork(),
      policies: [policy],
      runtimeRevision: () => policy.runtimeRevision,
    }),
  );
  await queue.start();
  process.send?.({ ready: process.pid });
});
