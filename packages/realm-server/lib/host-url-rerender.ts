import {
  logger,
  param,
  query,
  userInitiatedPriority,
  type DBAdapter,
  type QueuePublisher,
} from '@cardstack/runtime-common';
import { enqueueReindexRealmJob } from '@cardstack/runtime-common/jobs/reindex-realm';
import type { RealmRegistryReconciler } from './realm-registry-reconciler.ts';

const log = logger('realm-server:host-urls');

// Renders the realm's stored HTML again after a change to its host URLs that
// changes how that HTML is rendered. A realm with a host URL stores its
// default index card (CardsGrid or Workspace) in full, and a realm with none
// stores a placeholder for it, so the index card renders again when the realm
// gets its first host URL or loses its last one.
//
// The index card's row is marked as changed, then the realm is indexed. The
// pass visits only rows whose file changed or that carry no modified time, so
// it renders the index card and leaves the realm's other rows as they are.
//
// The host URL change has already been stored when this runs. A failure here
// is logged and not thrown, so the request still reports the change it made.
export async function renderAgainAfterHostURLChange({
  realmURL,
  dbAdapter,
  queue,
  reconciler,
}: {
  realmURL: string;
  dbAdapter: DBAdapter;
  queue: QueuePublisher;
  reconciler: RealmRegistryReconciler;
}): Promise<void> {
  try {
    let realm = await reconciler.lookupOrMount(realmURL);
    if (!realm) {
      log.warn(
        `could not render ${realmURL} again after a host URL change: the realm is not mounted`,
      );
      return;
    }
    await query(dbAdapter, [
      `UPDATE boxel_index SET last_modified = NULL WHERE realm_url =`,
      param(realmURL),
      `AND url =`,
      param(new URL('index.json', realmURL).href),
    ]);
    await enqueueReindexRealmJob(
      realmURL,
      await realm.getRealmOwnerUsername(),
      queue,
      dbAdapter,
      userInitiatedPriority,
      // The realm's users did not ask for an index pass, and the cards they
      // see do not change. A pass already running read the index card's
      // modified time, and whether the realm has a host URL, before this
      // change, so it can't stand in for this one.
      { realmEvents: false, freshPass: true },
    );
  } catch (error) {
    log.error(
      `could not render ${realmURL} again after a host URL change:`,
      error,
    );
  }
}
