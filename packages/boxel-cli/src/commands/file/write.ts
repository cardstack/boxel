import type { Command } from 'commander';
import { readFileSync } from 'fs';
import {
  getProfileManager,
  NO_ACTIVE_PROFILE_ERROR,
  type ProfileManager,
} from '../../lib/profile-manager';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';
import { SupportedMimeType } from '@cardstack/runtime-common/supported-mime-type';
import { isBinaryFilename } from '@cardstack/runtime-common';
import { FG_GREEN, FG_RED, DIM, RESET } from '../../lib/colors';
import { cliLog } from '../../lib/cli-log';

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
 * Write a file to a realm. Path should include the file extension.
 *
 * String content is sent with the card+source MIME type (the text path
 * .gts / .json / .md / etc. always took). Binary content (a `Uint8Array`,
 * including the `Buffer` subclass) is sent with `application/octet-stream`,
 * which the realm-server routes to `upsertBinaryFile` and writes verbatim.
 *
 * Uses the per-realm JWT via `ProfileManager.authedRealmFetch`.
 */
export async function write(
  realmUrl: string,
  path: string,
  content: string | Uint8Array,
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
  let isBinary = typeof content !== 'string';

  try {
    let response = await pm.authedRealmFetch(url, {
      method: 'POST',
      headers: isBinary
        ? { 'Content-Type': SupportedMimeType.OctetStream }
        : {
            Accept: SupportedMimeType.CardSource,
            'Content-Type': SupportedMimeType.CardSource,
          },
      // Both branches of `content: string | Uint8Array` are valid
      // BodyInit values, but TS narrows them as a union that doesn't
      // unify against the fetch signature without a hint.
      body: content as BodyInit,
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
      let content: string | Uint8Array;
      if (opts.file) {
        try {
          // When the local source file (and the destination path) is a
          // binary asset, read raw bytes so we can hand them to write()
          // unchanged. Forcing utf-8 would corrupt PNG / PDF / font /
          // etc. payloads silently.
          if (isBinaryFilename(opts.file) || isBinaryFilename(filePath)) {
            content = readFileSync(opts.file);
          } else {
            content = readFileSync(opts.file, 'utf-8');
          }
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
        cliLog.output(JSON.stringify(result, null, 2));
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
