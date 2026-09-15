import type { PgAdapter, NotificationSubscription } from '@cardstack/postgres';
import {
  LatticeWorkSuperseded,
  latticeWorkReasons,
  type LatticeWorkScope,
  type LatticeReadScope,
} from '@cardstack/runtime-common/lattice-work';
import type { LatticeNativeCardIndexRequest } from '@cardstack/runtime-common/lattice-native-index';
import type { LatticeNativeCardAdmission } from './lattice-native-card-indexer.ts';
import {
  latticeWorkDecision,
  type LatticeWorkClaim,
} from '@cardstack/runtime-common/lattice-kernel';

// Per-attempt scheduling guard. SQL rows are the current obligation; NOTIFY
// only prompts a recheck. The publication transaction still validates every
// input/code receipt. No notification is treated as permission to publish.
export async function openLatticeNativeWork(
  db: PgAdapter,
  request: LatticeNativeCardIndexRequest,
  admission: Pick<
    LatticeNativeCardAdmission,
    'deps' | 'resolve' | 'inputActor' | 'codeReference'
  >,
): Promise<LatticeWorkScope> {
  const controller = new AbortController();
  const subscriptions: NotificationSubscription[] = [];
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let checking: Promise<void> | undefined;
  let requested = false;
  let claim: LatticeWorkClaim | undefined;
  const dependencies = admission.deps.map((dep) =>
    admission.resolve(dep, request.url).replace(/\.(gts|gjs|ts|js)$/, ''),
  );
  const supersede = (reason: string, waitForRead?: LatticeReadScope) => {
    if (!stopped && !controller.signal.aborted)
      controller.abort(new LatticeWorkSuperseded(reason, waitForRead));
  };
  const inspect = async () => {
    const [row] = await db.execute(
      `SELECT g.current_generation, g.loader_epoch, o.dirty_generation,
         o.retired, p.read, r.url AS metadata_url, r.archived_at,
         CASE WHEN $5::jsonb IS NULL THEN TRUE ELSE lattice_code_reference_current($5::jsonb) END AS code_current,
         EXISTS(SELECT 1 FROM jobs j WHERE j.concurrency_group=$4
           AND j.status='unfulfilled'
           AND j.job_type IN ('incremental-index','from-scratch-index','copy-index')) AS source_pending,
         EXISTS(SELECT 1 FROM lattice_pending_generations t WHERE t.realm_url=$1) AS matching_pending
       FROM realm_generations g LEFT JOIN lattice_owners o ON o.realm_url=g.realm_url AND o.owner_url=$2
       LEFT JOIN realm_user_permissions p ON p.realm_url=g.realm_url AND p.username=$3
       LEFT JOIN realm_metadata r ON r.url=g.realm_url
       WHERE g.realm_url=$1`,
      {
        bind: [
          request.realmURL,
          request.url,
          admission.inputActor ?? '',
          'indexing:' + request.realmURL,
          admission.codeReference
            ? JSON.stringify(admission.codeReference)
            : null,
        ],
      },
    );
    if (stopped || controller.signal.aborted) return;
    const decision = latticeWorkDecision(
      {
        id: request.url,
        authorized:
          row?.read === true &&
          row.metadata_url === request.realmURL &&
          row.archived_at == null,
        sourcePending: Boolean(row?.source_pending),
        active: row?.retired === false,
        obligation:
          row?.dirty_generation == null ? null : Number(row.dirty_generation),
        inputsCurrent:
          Number(row?.current_generation) ===
            request.inputSnapshot?.generation && !row?.matching_pending,
        codeCurrent:
          Boolean(row?.code_current) &&
          row?.loader_epoch === request.loaderEpoch,
      },
      claim,
    );
    if (decision.status === 'ready') claim ??= decision.claim;
    else {
      supersede(
        latticeWorkReasons[decision.reason],
        decision.reason === 'authority-changed'
          ? { realmURL: request.realmURL, actor: admission.inputActor ?? '' }
          : undefined,
      );
    }
  };
  const wake = () => {
    if (stopped || controller.signal.aborted) return;
    requested = true;
    if (checking) return checking;
    checking = (async () => {
      while (requested && !stopped && !controller.signal.aborted) {
        requested = false;
        try {
          await inspect();
        } catch (error) {
          // Failure to check is not evidence of supersession. Stop this
          // attempt as an ordinary failure; normal retry policy still applies.
          if (!stopped) controller.abort(error);
        }
      }
    })().finally(() => {
      checking = undefined;
    });
    return checking;
  };
  const close = async () => {
    stopped = true;
    clearInterval(timer);
    await checking;
    await Promise.all(
      subscriptions.map((subscription) => subscription.unsubscribe()),
    );
  };
  try {
    subscriptions.push(
      await db.subscribe('jobs', () => {
        void wake();
      }),
    );
    subscriptions.push(
      await db.subscribe('realm_index_updated', ({ payload }) => {
        if (payload === request.realmURL) void wake();
      }),
    );
    subscriptions.push(
      await db.subscribe('lattice_code', () => {
        void wake();
      }),
    );
    subscriptions.push(
      await db.subscribe('module_cache_invalidated', ({ payload }) => {
        if (!payload) return;
        let event: any;
        try {
          event = JSON.parse(payload);
        } catch {
          return;
        }
        // Code dependencies may belong to another realm. Conservative aborts
        // are fine here; the next attempt re-admits current code before running.
        if (
          event.k === 'global' ||
          (event.k === 'realm' &&
            typeof event.r === 'string' &&
            dependencies.some((url) => url.startsWith(event.r))) ||
          (event.k === 'module' &&
            Array.isArray(event.m) &&
            event.m.some(
              (url: unknown) =>
                typeof url === 'string' &&
                dependencies.includes(url.replace(/\.(gts|gjs|ts|js)$/, '')),
            ))
        )
          supersede('a computation module was invalidated');
      }),
    );
    // Subscribe first, then inspect: no gap between snapshot and wake-up.
    await wake();
    controller.signal.throwIfAborted();
    // Recovery when notifications are missed. No timer survives the attempt.
    timer = setInterval(() => {
      void wake();
    }, 100);
    timer.unref();
    return { signal: controller.signal, close };
  } catch (error) {
    await close();
    throw error;
  }
}
