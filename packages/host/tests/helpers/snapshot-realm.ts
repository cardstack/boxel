import { getService } from '@universal-ember/test-support';

import type { RealmAction } from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';
import { baseRealm } from '@cardstack/runtime-common';

import type { SerializedServerState } from './mock-matrix/_server-state';
import type { MockUtils } from './mock-matrix/_utils';
import {
  type DbSnapshot,
  setupUserSubscription,
  setupAuthEndpoints,
  setupLocalIndexing,
  type NestedHooks,
  captureDbSnapshot,
  restoreDbSnapshot,
  deleteSnapshot,
  setupRendering,
  createTimingLogger,
} from '.';

import { initialize } from './base-realm';

export interface SnapshotBuildContext {
  isInitialBuild: boolean;
  loader: Loader;
  mockMatrixUtils: MockUtils;
}

interface SnapshotCache {
  loaderSnapshot: Loader;
  dbSnapshot: DbSnapshot;
  matrixState: SerializedServerState;
}

export interface SnapshotRealmHandle<T> {
  get(): T;
  invalidate(): void;
}

interface SetupSnapshotRealmOptions<T> {
  build: (context: SnapshotBuildContext) => Promise<T>;
  mockMatrixUtils: MockUtils;
  reInitialiseBaseRealm?: boolean; // TODO: default to true
  realmPermissions?: Record<string, RealmAction[]>;
  acceptanceTest?: boolean;
}

export function setupSnapshotRealm<T>(
  hooks: NestedHooks,
  options: SetupSnapshotRealmOptions<T>,
): SnapshotRealmHandle<T> {
  let cache: SnapshotCache | undefined;
  let latestState: T | undefined;

  hooks.beforeEach(async function () {
    let loaderService = getService('loader-service');
    if (cache) {
      loaderService.loader = Loader.cloneLoader(cache.loaderSnapshot, {
        includeEvaluatedModules: true,
      });
    }
  });
  hooks.beforeEach(async function () {
    setupRendering(options.acceptanceTest!!);
  });

  setupLocalIndexing(hooks);
  hooks.beforeEach(initialize);

  hooks.beforeEach(async function () {
    setupUserSubscription();
    setupAuthEndpoints(options.realmPermissions);

    let loaderService = getService('loader-service');

    if (cache) {
      await restoreDbSnapshot(cache.dbSnapshot);
      if (options.mockMatrixUtils) {
        options.mockMatrixUtils.restoreServerState(cache.matrixState);
      }
    }
    latestState = await options.build({
      isInitialBuild: !cache,
      loader: loaderService.loader,
      mockMatrixUtils: options.mockMatrixUtils,
    });

    if (!cache) {
      let clonedLoader = Loader.cloneLoader(loaderService.loader, {
        includeEvaluatedModules: true,
      });
      cache = {
        loaderSnapshot: clonedLoader,
        dbSnapshot: await captureDbSnapshot(),
        matrixState: options.mockMatrixUtils
          ? options.mockMatrixUtils.captureServerState()
          : undefined,
      };
    }
  });

  hooks.after(async function () {
    if (cache) {
      await deleteSnapshot(cache.dbSnapshot);
    }
  });

  return {
    get() {
      if (latestState === undefined) {
        throw new Error(
          'setupSnapshotRealm() called before the test state finished building',
        );
      }
      return latestState;
    },
    invalidate() {
      cache = undefined;
      latestState = undefined;
    },
  };
}
