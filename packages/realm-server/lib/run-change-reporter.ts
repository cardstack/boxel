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
//
// Finding the realm can mean starting it on this process. With `background`,
// the report resolves at once and the event follows, for a caller answering a
// request that shouldn't wait on that, such as a refusal at a run's cap.
export function realmServerRunChangeReporter({
  dbAdapter,
  virtualNetwork,
  reconciler,
  background = false,
}: {
  dbAdapter: DBAdapter;
  virtualNetwork: VirtualNetwork;
  reconciler: Pick<RealmRegistryReconciler, 'lookupOrMount'>;
  background?: boolean;
}): ReportRunChange {
  let report = runChangeReporter({
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
  return background
    ? async (runId) => {
        // `report` never rejects.
        void report(runId);
      }
    : report;
}
