import type { Command } from 'commander';
import {
  getProfileManager,
  NO_ACTIVE_PROFILE_ERROR,
  type ProfileManager,
} from '../../lib/profile-manager';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';
import { SupportedMimeType } from '@cardstack/runtime-common/supported-mime-type';
import { FG_RED, DIM, RESET } from '../../lib/colors';

export interface ReadCardResult {
  ok: boolean;
  status?: number;
  /** Parsed JSON document (for .json card files). */
  document?: Record<string, unknown>;
  error?: string;
}

export interface ReadCardCommandOptions {
  profileManager?: ProfileManager;
}

interface ReadCardCliOptions {
  realm: string;
}

/**
 * Read a card instance from a realm as parsed JSON.
 *
 * Uses `Accept: application/vnd.card+json` so the realm returns
 * the card document in JSON:API format.
 */
export async function readCard(
  realmUrl: string,
  path: string,
  options?: ReadCardCommandOptions,
): Promise<ReadCardResult> {
  let pm = options?.profileManager ?? getProfileManager();
  let active = pm.getActiveProfile();
  if (!active) {
    return {
      ok: false,
      error: NO_ACTIVE_PROFILE_ERROR,
    };
  }

  let url = new URL(path, ensureTrailingSlash(realmUrl)).href;

  let response: Response;
  try {
    response = await pm.authedRealmFetch(url, {
      method: 'GET',
      headers: { Accept: SupportedMimeType.CardJson },
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  if (!response.ok) {
    let body = await response.text().catch(() => '(no body)');
    return {
      ok: false,
      status: response.status,
      error: `HTTP ${response.status}: ${body.slice(0, 300)}`,
    };
  }

  let text = await response.text();
  try {
    let document = JSON.parse(text) as Record<string, unknown>;
    return { ok: true, status: response.status, document };
  } catch {
    return {
      ok: false,
      status: response.status,
      error: 'Failed to parse response as JSON',
    };
  }
}

export function registerCardReadCommand(parent: Command): void {
  parent
    .command('read')
    .description('Read a card instance from a realm as JSON')
    .argument(
      '<path>',
      'Realm-relative file path (e.g., Projects/my-project.json)',
    )
    .requiredOption('--realm <realm-url>', 'The realm URL to read from')
    .action(async (filePath: string, opts: ReadCardCliOptions) => {
      let result: ReadCardResult;
      try {
        result = await readCard(opts.realm, filePath);
      } catch (err) {
        console.error(
          `${FG_RED}Error:${RESET} ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }

      if (result.ok) {
        console.log(JSON.stringify(result.document, null, 2));
      } else {
        console.error(
          `${DIM}Status:${RESET} ${result.status ?? '(no status)'}`,
        );
        console.error(`${FG_RED}Error:${RESET} ${result.error}`);
        process.exit(1);
      }
    });
}
