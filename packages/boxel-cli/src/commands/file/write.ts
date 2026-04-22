import type { Command } from 'commander';
import { readFileSync } from 'fs';
import {
  getProfileManager,
  type ProfileManager,
} from '../../lib/profile-manager';
import { FG_GREEN, FG_RED, DIM, RESET } from '../../lib/colors';

export interface WriteResult {
  ok: boolean;
  error?: string;
}

export interface WriteCommandOptions {
  profileManager?: ProfileManager;
}

interface WriteCliOptions {
  realm: string;
  content?: string;
  file?: string;
  json?: boolean;
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

/**
 * Write a file to a realm. Content is sent as-is with card+source MIME type.
 * Path should include the file extension.
 *
 * Uses the per-realm JWT via `ProfileManager.authedRealmFetch`.
 */
export async function write(
  realmUrl: string,
  path: string,
  content: string,
  options?: WriteCommandOptions,
): Promise<WriteResult> {
  let pm = options?.profileManager ?? getProfileManager();
  let active = pm.getActiveProfile();
  if (!active) {
    return {
      ok: false,
      error: 'No active profile. Run `boxel profile add` to create one.',
    };
  }

  let url = new URL(path, ensureTrailingSlash(realmUrl)).href;

  try {
    let response = await pm.authedRealmFetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.card+source',
        'Content-Type': 'application/vnd.card+source',
      },
      body: content,
    });

    if (!response.ok) {
      let body = await response.text();
      return {
        ok: false,
        error: `HTTP ${response.status}: ${body.slice(0, 300)}`,
      };
    }

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function registerWriteCommand(parent: Command): void {
  parent
    .command('write')
    .description('Write a file to a realm')
    .argument(
      '<path>',
      'Realm-relative file path (e.g., hello.gts, Cards/my-card.json)',
    )
    .requiredOption('--realm <realm-url>', 'The realm URL to write to')
    .option('--content <content>', 'Inline content to write')
    .option('--file <filepath>', 'Read content from a local file')
    .option('--json', 'Output raw JSON response')
    .action(async (filePath: string, opts: WriteCliOptions) => {
      if (!opts.content && !opts.file) {
        console.error(
          `${FG_RED}Error:${RESET} Either --content or --file must be provided`,
        );
        process.exit(1);
      }

      if (opts.content && opts.file) {
        console.error(
          `${FG_RED}Error:${RESET} Cannot specify both --content and --file`,
        );
        process.exit(1);
      }

      let content: string;
      if (opts.file) {
        try {
          content = readFileSync(opts.file, 'utf-8');
        } catch (err) {
          console.error(
            `${FG_RED}Error:${RESET} Could not read file: ${err instanceof Error ? err.message : String(err)}`,
          );
          process.exit(1);
        }
      } else {
        content = opts.content!;
      }

      let result: WriteResult;
      try {
        result = await write(opts.realm, filePath, content);
      } catch (err) {
        console.error(
          `${FG_RED}Error:${RESET} ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else if (result.ok) {
        console.log(
          `${FG_GREEN}Written:${RESET} ${filePath} ${DIM}→${RESET} ${opts.realm}`,
        );
      } else {
        console.error(`${FG_RED}Error:${RESET} ${result.error}`);
      }

      if (!result.ok) {
        process.exit(1);
      }
    });
}
