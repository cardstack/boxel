/**
 * Index-page bootstrap for a freshly-created factory target realm.
 *
 * `create-realm` seeds every new realm with a default `index.json` that
 * adopts `CardsGrid`. For realms the factory creates, we replace that
 * with an instance of `RealmDashboard` (defined in the software-factory
 * realm at `realm/realm-dashboard.gts`) so the realm opens to the
 * factory dashboard — project KPIs, the issue board, and validation runs
 * — instead of a bare card grid.
 *
 * This only runs for realms the factory just created; a pre-existing
 * realm keeps whatever index page it already has.
 */

import type { BoxelCLIClient } from '@cardstack/boxel-cli/api';

import { logger } from './logger.ts';
import {
  inferIssueTrackerModuleUrl,
  linkRelationshipToCard,
  toRealmRelativePath,
} from './realm-operations.ts';
import { writeCard } from './workspace-fs.ts';

let log = logger('factory-realm-index');

const INDEX_CARD_FILE = 'index.json';
const CARDS_GRID_FILE = 'cards-grid.json';
// Realm-relative link from index.json to the CardsGrid instance, without
// the `.json` extension (links reference card ids, not file paths).
const CARDS_GRID_LINK = './cards-grid';

/**
 * Infer the `RealmDashboard` module URL from a target realm URL. The
 * card lives in the software-factory realm, which is mounted at
 * `<origin>/software-factory/`, mirroring `inferDarkfactoryModuleUrl`.
 */
export function inferRealmDashboardModuleUrl(targetRealm: string): string {
  let parsed = new URL(targetRealm);
  return new URL('software-factory/realm-dashboard', parsed.origin + '/').href;
}

/**
 * Set the realm's index page to a `RealmDashboard` instance, overwriting
 * the default `CardsGrid` index that `create-realm` seeded.
 *
 * Writes two files: a sibling `cards-grid.json` holding the `CardsGrid`
 * instance (the same empty grid `create-realm` would have made), and
 * `index.json` adopting `RealmDashboard` with its `cardsGrid` link
 * pointing at that instance — so the dashboard's catalog tab shows the
 * realm's cards. The `board` link is left for the bootstrap agent to wire
 * once it creates the IssueTracker. The caller syncs the workspace to the
 * realm afterwards.
 */
export async function writeRealmDashboardCard(
  workspaceDir: string,
  targetRealm: string,
): Promise<void> {
  let cardsGridDocument = {
    data: {
      type: 'card' as const,
      meta: {
        adoptsFrom: {
          module: 'https://cardstack.com/base/cards-grid',
          name: 'CardsGrid',
        },
      },
    },
  };

  await write(workspaceDir, CARDS_GRID_FILE, cardsGridDocument);

  let moduleUrl = inferRealmDashboardModuleUrl(targetRealm);
  let indexDocument = {
    data: {
      type: 'card' as const,
      relationships: {
        cardsGrid: {
          links: {
            self: CARDS_GRID_LINK,
          },
        },
      },
      meta: {
        adoptsFrom: {
          module: moduleUrl,
          name: 'RealmDashboard',
        },
      },
    },
  };

  log.info(`Setting realm index page to RealmDashboard (${moduleUrl})`);
  await write(workspaceDir, INDEX_CARD_FILE, indexDocument);
}

async function write(
  workspaceDir: string,
  path: string,
  document: unknown,
): Promise<void> {
  let writeResult = await writeCard(
    workspaceDir,
    path,
    JSON.stringify(document, null, 2),
  );

  if (!writeResult.ok) {
    throw new Error(
      `Failed to write ${path}: ${writeResult.error ?? 'unknown error'}`,
    );
  }
}

export interface LinkBoardToRealmIndexOptions {
  client: BoxelCLIClient;
  realmUrl: string;
  workspaceDir: string;
  /** From `inferDarkfactoryModuleUrl(realmUrl)`. */
  darkfactoryModuleUrl: string;
  /**
   * How many times to retry the IssueTracker search when it comes back
   * empty. The board is synced to the realm fire-and-forget (no
   * `waitForIndex`), so an empty result can just mean the indexer hasn't
   * caught up. The post-loop backstop sets this so a fast run (bootstrap is
   * the last work) doesn't permanently leave the index board link unset; the
   * in-loop hook leaves it at the default 0 — the backstop is its safety net.
   */
  searchRetries?: number;
  /** Delay between empty-result retries. Defaults to `SEARCH_RETRY_DELAY_MS`. */
  searchRetryDelayMs?: number;
  /**
   * Write the board link as an absolute card URL instead of a
   * realm-relative `./path`. Required under the v3 control/product split:
   * the index card lives in the product realm while the IssueTracker
   * board lives in the control realm, so a relative link would dangle.
   */
  absoluteLink?: boolean;
}

/**
 * Point the realm index's `board` relationship at the IssueTracker the
 * bootstrap agent created, once it exists in the realm.
 *
 * The index card is written before the issue loop runs, when no board
 * exists yet, so its `board` link starts empty. After the bootstrap issue
 * creates and syncs an IssueTracker, this finds it and patches the
 * workspace `index.json` in place (preserving the `cardsGrid` link).
 * Returns `true` when it modified the index so the caller can sync; a
 * no-op (no board indexed, or the link is already correct) returns
 * `false`.
 */
export async function linkBoardToRealmIndex(
  options: LinkBoardToRealmIndexOptions,
): Promise<boolean> {
  let { client, realmUrl, workspaceDir, darkfactoryModuleUrl } = options;
  let issueTrackerModuleUrl = inferIssueTrackerModuleUrl(darkfactoryModuleUrl);

  return linkRelationshipToCard({
    client,
    realmUrl,
    workspaceDir,
    cardFile: INDEX_CARD_FILE,
    relationshipKey: 'board',
    targetLabel: 'IssueTracker board',
    search: () =>
      client.search(realmUrl, {
        filter: {
          type: { module: issueTrackerModuleUrl, name: 'IssueTracker' },
        },
        // One board per bootstrapped realm; newest-first so a re-run that
        // somehow produced more than one links the most recently created.
        // linkProjectToSeedIssue selects the Project the same way, so the
        // board and the seed issue's project stay on the same generation.
        sort: [{ by: 'lastModified', direction: 'desc' as const }],
      }),
    buildLink: (id, realm) =>
      options.absoluteLink === true
        ? id
        : `./${toRealmRelativePath(id, realm)}`,
    log,
    searchRetries: options.searchRetries,
    searchRetryDelayMs: options.searchRetryDelayMs,
  });
}
