import { click, find, findAll, triggerKeyEvent } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';

import { TrackedObject } from 'tracked-built-ins';

import type { RealmPermissions } from '@cardstack/runtime-common';

import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import {
  setupMockMatrix,
  type Config as MockMatrixConfig,
} from './mock-matrix';
import { setupApplicationTest } from './setup';

import {
  type RealmContents,
  setupAcceptanceTestRealm,
  setupAuthEndpoints,
  setupLocalIndexing,
  setupRealmCacheTeardown,
  setupUserSubscription,
  realmConfigCardJSON,
} from '.';

export type DashboardRealm = Awaited<
  ReturnType<typeof setupAcceptanceTestRealm>
>['realm'];

export const realmURL = 'http://test-realm/testuser/workspace-a/';

// Clicks the option's visible label, as a user does; the radio inside it is
// visually hidden.
export async function clickScopeOption(value: 'all' | 'hosted') {
  let radio = find(
    `[data-test-dashboard-filter] [data-test-pretui-segmented-option="${value}"]`,
  );
  let label = radio?.closest('label');
  if (!label) {
    throw new Error(`no label for the ${value} scope option`);
  }
  await click(label);
}

// Publishing is what makes a workspace hosted.
export function markHosted(
  url: string,
  lastPublishedAt: Record<string, string> = {
    'https://published.example.com/': String(Date.now()),
  },
) {
  let realmResource = (getService('realm') as any).realms.get(url);
  realmResource.info = new TrackedObject({
    ...realmResource.info,
    lastPublishedAt,
  });
}

// An IconButton whose tip matches its label is named by the tip.
export function nameFromTip(selector: string) {
  let id = find(selector)?.getAttribute('aria-labelledby') ?? '';
  return document.getElementById(id)?.textContent?.trim();
}

// The text of each element a button's aria-describedby points at, in order.
export function descriptionOf(selector: string) {
  let ids = find(selector)?.getAttribute('aria-describedby')?.split(' ') ?? [];
  return ids.map((id) => document.getElementById(id)?.textContent?.trim());
}

export async function pressKey(key: string) {
  let target = document.activeElement;
  if (!(target instanceof HTMLElement)) {
    throw new Error('nothing has focus');
  }
  await triggerKeyEvent(target, 'keydown', key);
}

export function sectionOrder() {
  return findAll('[data-test-dashboard-section]').map((section) =>
    section.getAttribute('data-test-dashboard-section'),
  );
}

export function railOrder() {
  return findAll('[data-test-section-rail-entry]').map((entry) =>
    entry.getAttribute('data-test-section-rail-entry'),
  );
}

export function operatorModeState() {
  return getService('operator-mode-state-service') as OperatorModeStateService;
}

export interface DashboardRealmFixture {
  url: string;
  name: string;
  // The test user owns the realm unless this says otherwise.
  permissions?: RealmPermissions;
  // Files besides `realm.json`, which `name` fills.
  contents?: RealmContents;
}

export interface DashboardTestOptions {
  // Replaces the default config instead of merging into it.
  matrix?: MockMatrixConfig;
  realms?: DashboardRealmFixture[];
  authEndpoints?: boolean;
  // Registers hooks that must run before the realms are set up.
  beforeRealms?: (hooks: NestedHooks) => void;
  onRealm?: (realm: DashboardRealm, url: string) => void;
}

// Sets up the application, the mock Matrix server and the realms each test
// starts with. By default the test user, shown as Ada Lovelace, owns
// Workspace A, and their stored dashboard state has Codex picked with two of
// its setup steps copied; the state and agents tests assert on that state.
export function setupDashboardTest(
  hooks: NestedHooks,
  {
    matrix = {
      loggedInAs: '@testuser:localhost',
      displayName: 'Ada Lovelace',
      activeRealms: [realmURL],
      dashboardState: {
        agent: 'codex',
        agentSetup: { codex: 2 },
      },
    },
    realms = [{ url: realmURL, name: 'Workspace A' }],
    authEndpoints = true,
    beforeRealms,
    onRealm,
  }: DashboardTestOptions = {},
) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupRealmCacheTeardown(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, matrix);

  beforeRealms?.(hooks);

  hooks.beforeEach(async function () {
    setupUserSubscription();
    if (authEndpoints) {
      setupAuthEndpoints();
    }
    for (let { url, name, permissions, contents } of realms) {
      let { realm } = await setupAcceptanceTestRealm({
        realmURL: url,
        mockMatrixUtils,
        permissions: permissions ?? {
          '@testuser:localhost': ['read', 'write', 'realm-owner'],
        },
        contents: {
          'realm.json': realmConfigCardJSON({ name }),
          ...contents,
        },
      });
      onRealm?.(realm, url);
    }
  });

  return mockMatrixUtils;
}
