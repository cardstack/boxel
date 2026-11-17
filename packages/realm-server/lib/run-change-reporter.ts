import {
  logger,
  runChangeReporter,
  type DBAdapter,
  type ReportRunChange,
  type VirtualNetwork,
} from '@cardstack/runtime-common';
import type { RealmRegistryReconciler } from './realm-registry-reconciler.ts';
import { normalizeRealmURL } from '../utils/realm-url.ts';

const log = logger('realm:job-event');

// Reports a run's change from a route that serves no one realm, such as the
// request forwarder or archiving: the run's realm is found through the
// reconciler, which mounts it if this process hasn't, and delivers the event
// as `Realm.broadcastJobEvent` does, to its direct writers alone.
export function realmServerRunChangeReporter({
  dbAdapter,
  virtualNetwork,
  reconciler,
}: {
  dbAdapter: DBAdapter;
  virtualNetwork: VirtualNetwork;
  reconciler: Pick<RealmRegistryReconciler, 'lookupOrMount'>;
}): ReportRunChange {
  return runChangeReporter({
    dbAdapter,
    virtualNetwork,
    log,
    send: async (event) => {
      let realmURL = normalizeRealmURL(event.realmURL);
      let realm = realmURL
        ? await reconciler.lookupOrMount(realmURL.href)
        : undefined;
      if (!realm) {
        log.warn(
          `no realm at ${event.realmURL} to send run ${event.runId}'s job event from`,
        );
        return;
      }
      await realm.broadcastJobEvent(event);
    },
  });
}
