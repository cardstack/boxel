import type { Command } from 'commander';
import { readFileSync } from 'fs';
import {
  getProfileManager,
  NO_ACTIVE_PROFILE_ERROR,
  type ProfileManager,
} from '../../lib/profile-manager';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';
import { SupportedMimeType } from '@cardstack/runtime-common/supported-mime-type';
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
  file?: string;
  json?: boolean;
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
      error: NO_ACTIVE_PROFILE_ERROR,
    };
  }

  let url = new URL(path, ensureTrailingSlash(realmUrl)).href;

  try {
    let response = await pm.authedRealmFetch(url, {
      method: 'POST',
      headers: {
        Accept: SupportedMimeType.CardSource,
        'Content-Type': SupportedMimeType.CardSource,
      },
      body: content,
    });

    if (!response.ok) {
      let body = await response.text().catch(() => '(no body)');
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

/** Write to stderr so hints don't pollute stdout (important when piping/--json). */
function stderr(msg: string): void {
  process.stderr.write(msg + '\n');
}

async function readStdin(): Promise<string> {
  let chunks: Buffer[] = [];
  for await (let chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

export function registerWriteCommand(parent: Command): void {
  parent
    .command('write')
    .description('Write a file to a realm (reads content from STDIN or --file)')
    .argument(
      '<path>',
      'Realm-relative file path (e.g., hello.gts, Cards/my-card.json)',
    )
    .requiredOption('--realm <realm-url>', 'The realm URL to write to')
    .option(
      '--file <filepath>',
      'Read content from a local file instead of STDIN',
    )
    .option('--json', 'Output raw JSON response')
    .action(async (filePath: string, opts: WriteCliOptions) => {
      let content: string;
      if (opts.file) {
        try {
          content = readFileSync(opts.file, 'utf-8');
        } catch (err) {
          stderr(
            `${FG_RED}Error:${RESET} Could not read file: ${err instanceof Error ? err.message : String(err)}`,
          );
          process.exit(1);
        }
      } else {
        if (process.stdin.isTTY) {
          stderr(
            `${DIM}Reading from STDIN. Type or paste content, then press Enter followed by Ctrl+D to finish.${RESET}`,
          );
        }
        content = await readStdin();
        stderr(
          `${DIM}Received ${content.length} bytes. Writing to realm...${RESET}`,
        );
      }

      let result: WriteResult;
      try {
        result = await write(opts.realm, filePath, content);
      } catch (err) {
        stderr(
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
        stderr(`${FG_RED}Error:${RESET} ${result.error}`);
      }

      if (!result.ok) {
        process.exit(1);
      }
    });
}
