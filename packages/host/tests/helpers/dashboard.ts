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
import { getTestRealmRegistry } from './test-realm-registry';

import {
  type RealmContents,
  setupAcceptanceTestRealm,
  setupAuthEndpoints,
  setupLocalIndexing,
  setupRealmCacheTeardown,
  setupUserSubscription,
  realmConfigCardJSON,
} from '.';

import type { MockUtils } from './mock-matrix/_utils';

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

// A write to a workspace is what moves its update time.
export function markUpdated(url: string, updatedAt: Date) {
  let realmResource = (getService('realm') as any).realms.get(url);
  realmResource.info = new TrackedObject({
    ...realmResource.info,
    updatedAt: updatedAt.toISOString(),
  });
}

// Changes a workspace's info as the realm reports it, so a reload of the
// info keeps the change.
export function overrideRealmInfo(
  url: string,
  change: Record<string, unknown>,
) {
  let realm = getTestRealmRegistry().get(url)?.realm;
  if (!realm) {
    throw new Error(`no test realm at ${url}`);
  }
  let getRealmInfo = realm.getRealmInfo.bind(realm);
  realm.getRealmInfo = async () => ({ ...(await getRealmInfo()), ...change });
  let realmResource = (getService('realm') as any).realms.get(url);
  realmResource.info = new TrackedObject({ ...realmResource.info, ...change });
}

// The realm server marks a workspace publishable; a published copy isn't.
export function markPublishable(url: string) {
  overrideRealmInfo(url, { publishable: true });
}

export const ownedRealmURL = 'http://test-realm/testuser/workspace-b/';
export const sharedRealmURL = 'http://test-realm/testuser/workspace-c/';

// Adds Workspace B, which the test user owns too, and Workspace C, which is
// shared with them to read only, to the dashboard's Workspace A.
export function setupMoreWorkspaces(
  hooks: NestedHooks,
  mockMatrixUtils: MockUtils,
) {
  hooks.beforeEach(async function () {
    for (let [url, name, permissions] of [
      [ownedRealmURL, 'Workspace B', ['read', 'write', 'realm-owner']],
      [sharedRealmURL, 'Workspace C', ['read']],
    ] as const) {
      await setupAcceptanceTestRealm({
        realmURL: url,
        mockMatrixUtils,
        permissions: { '@testuser:localhost': [...permissions] },
        contents: { 'realm.json': realmConfigCardJSON({ name }) },
      });
      // A session minted again later, as reauthenticating does, carries
      // the same permissions.
      mockMatrixUtils.setRealmSessionPermissions(url, [...permissions]);
    }
    mockMatrixUtils.setRealmSessionPermissions(realmURL, [
      'read',
      'write',
      'realm-owner',
    ]);
    mockMatrixUtils.setActiveRealms([realmURL, ownedRealmURL, sharedRealmURL]);
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

export const RECENT_TILES =
  '[data-test-workspace-recent-list] [data-test-workspace]';

// Sets the width of the app under test, which the dashboard's tiles and rows
// lay out in, and puts it back after each test.
export function setupDashboardWidth(hooks: NestedHooks) {
  let originalWidth: string | undefined;
  let testingRoot = () => document.querySelector<HTMLElement>('#ember-testing');
  hooks.afterEach(function () {
    if (originalWidth !== undefined) {
      testingRoot()?.style.setProperty('width', originalWidth);
      originalWidth = undefined;
    }
  });
  return (width: string) => {
    originalWidth ??= testingRoot()?.style.width ?? '';
    testingRoot()?.style.setProperty('width', width);
  };
}

// Asserts the element at `selector` is a list of `count` items, as assistive
// technology counts them: a `ul` with the list role, which Safari drops from a
// list with no markers, whose children are all `li`s. Returns the items.
export function assertList(
  assert: Assert,
  selector: string,
  count: number,
  message = `${selector} has ${count} items`,
): Element[] {
  let list = find(selector);
  assert.strictEqual(list?.tagName, 'UL', `${selector} is a list`);
  assert.strictEqual(
    list?.getAttribute('role'),
    'list',
    `${selector} keeps its list role`,
  );
  let items = [...(list?.children ?? [])];
  assert.deepEqual(
    items.map((item) => item.tagName),
    Array(count).fill('LI'),
    message,
  );
  return items;
}

// The hover rules in the scoped styles of the component that rendered the
// element at `selector`, by the devices they apply to. A tap on a touch screen
// leaves `:hover` on what it touched, so a hover rule that applies on any
// device sticks after a tap; one inside `@media (hover: hover)` applies only
// where the device can hover. The element must be one the component renders
// itself, not through `...attributes`, so it carries only that component's
// scope.
function scopedHoverRules(selector: string): {
  onAnyDevice: string[];
  onlyWhereHoverable: string[];
} {
  let element = find(selector);
  if (!element) {
    throw new Error(`no element at ${selector}`);
  }
  let scopes = element
    .getAttributeNames()
    .filter((name) => name.startsWith('data-scopedcss-'));
  if (scopes.length !== 1) {
    throw new Error(
      `${selector} carries ${scopes.length} scoped CSS attributes, not one`,
    );
  }
  let scope = `[${scopes[0]}`;
  let found = {
    onAnyDevice: [] as string[],
    onlyWhereHoverable: [] as string[],
  };
  // A rule nested in a style rule shares its parent's scope, and its hover.
  let visit = (
    rules: Iterable<CSSRule>,
    canHover: boolean,
    inScope: boolean,
    onHover: boolean,
  ) => {
    for (let rule of rules) {
      // Ahead of the grouping rules: a style rule is one, so it can nest.
      if (rule instanceof CSSStyleRule) {
        let scoped = inScope || rule.selectorText.includes(scope);
        let hovered = onHover || rule.selectorText.includes(':hover');
        if (scoped && hovered && rule.style.length > 0) {
          (canHover ? found.onlyWhereHoverable : found.onAnyDevice).push(
            rule.selectorText,
          );
        }
        visit(rule.cssRules, canHover, scoped, hovered);
      } else if (rule instanceof CSSNestedDeclarations) {
        // Bare declarations in a rule nested in a style rule, such as an
        // `@media` block.
        if (inScope && onHover && rule.style.length > 0) {
          (canHover ? found.onlyWhereHoverable : found.onAnyDevice).push(
            rule.cssText,
          );
        }
      } else if (rule instanceof CSSMediaRule) {
        let hoverOnly = canHover || isHoverOnly(rule.media);
        visit(rule.cssRules, hoverOnly, inScope, onHover);
      } else if (rule instanceof CSSGroupingRule) {
        visit(rule.cssRules, canHover, inScope, onHover);
      }
    }
  };
  for (let sheet of document.styleSheets) {
    visit(rulesOf(sheet), false, false, false);
  }
  return found;
}

function rulesOf(sheet: CSSStyleSheet): Iterable<CSSRule> {
  try {
    return sheet.cssRules;
  } catch {
    return []; // a cross-origin stylesheet
  }
}

// Whether a media list applies only where the device can hover: each of its
// queries requires `(hover: hover)`, alongside any other conditions. Only that
// literal form counts, so another way of writing it fails the test rather
// than passing it.
function isHoverOnly(media: MediaList): boolean {
  let queries = [...media];
  return (
    queries.length > 0 &&
    queries.every(
      (query) =>
        !query.startsWith('not ') &&
        query.split(' and ').includes('(hover: hover)'),
    )
  );
}

// Asserts the component that rendered the element at `selector` has hover
// effects in its own styles, and only where the device can hover, so a tap on
// a touch screen leaves none of them behind. The styles of the components it
// renders aren't read.
export function assertHoverOnlyWhereHoverable(
  assert: Assert,
  selector: string,
  label: string,
) {
  let { onAnyDevice, onlyWhereHoverable } = scopedHoverRules(selector);
  assert.deepEqual(
    onAnyDevice,
    [],
    `${label}: no hover effect on a device that can't hover`,
  );
  assert.true(
    onlyWhereHoverable.length > 0,
    `${label}: hover effects where the device can hover`,
  );
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
