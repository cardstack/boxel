import type { Command } from 'commander';
import {
  getProfileManager,
  type ProfileManager,
} from '../../lib/profile-manager';
import { FG_RED, DIM, RESET } from '../../lib/colors';

export interface ReadResult {
  ok: boolean;
  status?: number;
  /** Parsed JSON document (for .json files). */
  document?: Record<string, unknown>;
  /** Raw text content (for non-JSON files like .gts). */
  content?: string;
  error?: string;
}

export interface ReadCommandOptions {
  profileManager?: ProfileManager;
}

interface ReadCliOptions {
  realm: string;
  json?: boolean;
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

/**
 * Read a file from a realm. Returns parsed JSON for .json files,
 * raw text for everything else (.gts, etc.).
 *
 * Uses the per-realm JWT via `ProfileManager.authedRealmFetch`.
 */
export async function read(
  realmUrl: string,
  path: string,
  options?: ReadCommandOptions,
): Promise<ReadResult> {
  let pm = options?.profileManager ?? getProfileManager();
  let active = pm.getActiveProfile();
  if (!active) {
    return {
      ok: false,
      error: 'No active profile. Run `boxel profile add` to create one.',
    };
  }

  let url = new URL(path, ensureTrailingSlash(realmUrl)).href;

  let response: Response;
  try {
    response = await pm.authedRealmFetch(url, {
      method: 'GET',
      headers: { Accept: 'application/vnd.card+source' },
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
    return { ok: true, status: response.status, content: text };
  }
}

export function registerReadCommand(parent: Command): void {
  parent
    .command('read')
    .description(
      'Read a file from a realm. Returns parsed JSON for .json files, raw text for everything else.',
    )
    .argument(
      '<path>',
      'Realm-relative file path (e.g., hello-world.json, Cards/my-card.gts)',
    )
    .requiredOption('--realm <realm-url>', 'The realm URL to read from')
    .option('--json', 'Output raw JSON response')
    .action(async (filePath: string, opts: ReadCliOptions) => {
      let result: ReadResult;
      try {
        result = await read(opts.realm, filePath);
      } catch (err) {
        console.error(
          `${FG_RED}Error:${RESET} ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else if (result.ok) {
        if (result.document) {
          console.log(JSON.stringify(result.document, null, 2));
        } else {
          console.log(result.content ?? '');
        }
      } else {
        console.error(
          `${DIM}Status:${RESET} ${result.status ?? '(no status)'}`,
        );
        console.error(`${FG_RED}Error:${RESET} ${result.error}`);
      }

      if (!result.ok) {
        process.exit(1);
      }
    });
}
