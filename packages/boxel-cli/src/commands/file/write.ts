import type { Command } from 'commander';
import { readFileSync } from 'fs';
import type { ProfileManager } from '../../lib/profile-manager.ts';
import { resolveRealmAuthenticator } from '../../lib/auth-resolver.ts';
import { resolveRealmIdentifier } from '../../lib/resolve-realm-identifier.ts';
import { resolveRealmSecretSeed } from '../../lib/prompt.ts';
import type { RealmAuthenticator } from '../../lib/realm-authenticator.ts';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';
import { SupportedMimeType } from '@cardstack/runtime-common/supported-mime-type';
import { isBinaryFilename } from '@cardstack/runtime-common/infer-content-type';
import { FG_GREEN, FG_RED, DIM, RESET } from '../../lib/colors.ts';
import { cliLog } from '../../lib/cli-log.ts';

export interface WriteResult {
  ok: boolean;
  error?: string;
}

export interface WriteCommandOptions {
  profileManager?: ProfileManager;
  /** Pre-resolved realm secret seed for administrative (seed) auth. */
  realmSecretSeed?: string;
  /** @internal Test hook: supply an already-constructed authenticator. */
  authenticator?: RealmAuthenticator;
}

interface WriteCliOptions {
  realm: string;
  file?: string;
  json?: boolean;
  realmSecretSeed?: boolean;
}

/**
 * Write a file to a realm. Path should include the file extension.
 *
 * String content is sent with the card+source MIME type (the text path
 * .gts / .json / .md / etc. always took). Binary content (a `Uint8Array`,
 * including the `Buffer` subclass) is sent with `application/octet-stream`,
 * which the realm-server routes to `upsertBinaryFile` and writes verbatim.
 *
 * Auth is resolved via `resolveRealmAuthenticator`: a realm secret seed (when
 * supplied) mints a JWT locally as the realm-server bot; otherwise the active
 * Matrix profile's per-realm JWT is used.
 */
export async function write(
  realmUrl: string,
  path: string,
  content: string | Uint8Array,
  options?: WriteCommandOptions,
): Promise<WriteResult> {
  let resolvedRealm = resolveRealmIdentifier(realmUrl, {
    profileManager: options?.profileManager,
  });
  if (!resolvedRealm.ok) {
    return { ok: false, error: resolvedRealm.error };
  }
  realmUrl = resolvedRealm.url;
  let resolution = resolveRealmAuthenticator({
    realmUrl,
    realmSecretSeed: options?.realmSecretSeed,
    profileManager: options?.profileManager,
    authenticator: options?.authenticator,
  });
  if (!resolution.ok) {
    return { ok: false, error: resolution.error };
  }
  let authenticator = resolution.authenticator;

  let url = new URL(path, ensureTrailingSlash(realmUrl)).href;
  let isBinary = typeof content !== 'string';

  // Defense-in-depth for programmatic callers (BoxelClient.write, tests).
  // The CLI wrapper has an earlier guard against `--file image.png` →
  // `notes.md` style misuse, but the library function is also reachable
  // without going through that branch. Reject the mismatch here so raw
  // bytes never land at a text extension (corrupt-on-read) and a UTF-8
  // string never lands at a binary extension (corrupt-on-write).
  let pathIsBinary = isBinaryFilename(path);
  if (pathIsBinary !== isBinary) {
    return {
      ok: false,
      error:
        `Path ${path} is ${pathIsBinary ? 'binary' : 'text'} by extension ` +
        `but content is ${isBinary ? 'bytes' : 'a string'}. ` +
        `Refusing to write to avoid silent corruption.`,
    };
  }

  try {
    let response = await authenticator.authedRealmFetch(url, {
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
    .option(
      '--realm-secret-seed',
      'Administrative auth: prompt for a realm secret seed and mint a JWT locally instead of using a Matrix profile (env: BOXEL_REALM_SECRET_SEED)',
    )
    .option('--json', 'Output raw JSON response')
    .action(async (filePath: string, opts: WriteCliOptions) => {
      // Resolve the seed before consuming stdin: when content arrives on stdin
      // and --realm-secret-seed prompts, both would contend for stdin. Wrapped
      // so a seed-resolution throw (e.g. non-TTY stdin) is a clean error.
      let realmSecretSeed: string | undefined;
      try {
        realmSecretSeed = await resolveRealmSecretSeed(
          opts.realmSecretSeed === true,
        );
      } catch (err) {
        stderr(
          `${FG_RED}Error:${RESET} ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }

      let content: string | Uint8Array;
      if (opts.file) {
        // Refuse a source/destination binary-classification mismatch
        // (e.g., `write notes.md --file image.png`) — otherwise raw
        // bytes would land at a text extension and corrupt-on-read.
        const srcIsBinary = isBinaryFilename(opts.file);
        const dstIsBinary = isBinaryFilename(filePath);
        if (srcIsBinary !== dstIsBinary) {
          stderr(
            `${FG_RED}Error:${RESET} source file ${opts.file} is ${
              srcIsBinary ? 'binary' : 'text'
            } but destination path ${filePath} is ${
              dstIsBinary ? 'binary' : 'text'
            }. Refusing to write to avoid silent corruption — rename the destination to match.`,
          );
          process.exit(1);
        }
        try {
          // Binary source files are read as raw bytes so write() can
          // hand them to the realm unchanged; forcing utf-8 would
          // corrupt PNG / PDF / font / etc. payloads silently.
          content = srcIsBinary
            ? readFileSync(opts.file)
            : readFileSync(opts.file, 'utf-8');
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
        result = await write(opts.realm, filePath, content, {
          realmSecretSeed,
        });
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
