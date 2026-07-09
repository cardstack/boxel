import type { Command } from 'commander';
import type { ProfileManager } from '../../lib/profile-manager.ts';
import { resolveRealmAuthenticator } from '../../lib/auth-resolver.ts';
import {
  resolveRealmIdentifier,
  splitRealmResourceIdentifier,
} from '../../lib/resolve-realm-identifier.ts';
import { resolveRealmSecretSeed } from '../../lib/prompt.ts';
import type { RealmAuthenticator } from '../../lib/realm-authenticator.ts';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';
import { SupportedMimeType } from '@cardstack/runtime-common/supported-mime-type';
import { isBinaryFilename } from '@cardstack/runtime-common/infer-content-type';
import { FG_RED, DIM, RESET } from '../../lib/colors.ts';
import { cliLog } from '../../lib/cli-log.ts';

export interface ReadResult {
  ok: boolean;
  status?: number;
  /** Raw text content of the file. Populated for non-binary paths. */
  content?: string;
  /**
   * Raw bytes. Populated when the requested path is a binary filename
   * (PNG, PDF, font, etc.) — see `isBinaryFilename`. Mutually exclusive
   * with `content`.
   */
  bytes?: Uint8Array;
  error?: string;
}

export interface ReadCommandOptions {
  profileManager?: ProfileManager;
  /** Pre-resolved realm secret seed for administrative (seed) auth. */
  realmSecretSeed?: string;
  /** @internal Test hook: supply an already-constructed authenticator. */
  authenticator?: RealmAuthenticator;
}

interface ReadCliOptions {
  realm?: string;
  json?: boolean;
  realmSecretSeed?: boolean;
}

/**
 * Read a file from a realm. Returns raw text in `content` for text files;
 * returns raw bytes in `bytes` for binary files (PNG / PDF / font / etc.,
 * per `isBinaryFilename`). Callers should parse the content themselves
 * if needed (e.g. JSON).
 *
 * Auth is resolved via `resolveRealmAuthenticator`: a realm secret seed (when
 * supplied) mints a JWT locally as the realm-server bot; otherwise the active
 * Matrix profile's per-realm JWT is used.
 */
export async function read(
  realmUrl: string,
  path: string,
  options?: ReadCommandOptions,
): Promise<ReadResult> {
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

  let response: Response;
  try {
    response = await authenticator.authedRealmFetch(url, {
      method: 'GET',
      headers: { Accept: SupportedMimeType.CardSource },
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

  if (isBinaryFilename(path)) {
    let bytes = new Uint8Array(await response.arrayBuffer());
    return { ok: true, status: response.status, bytes };
  }

  let text = await response.text();
  return { ok: true, status: response.status, content: text };
}

export function registerReadCommand(parent: Command): void {
  parent
    .command('read')
    .description('Read a file from a realm')
    .argument(
      '<path>',
      'Realm-relative file path (e.g., hello-world.json, Cards/my-card.gts), or a full @cardstack/ identifier (e.g., @cardstack/catalog/hello.gts) in which case --realm is omitted',
    )
    .option(
      '--realm <realm-url>',
      'The realm URL or @cardstack/<realm>/ identifier to read from (required unless <path> is a full @cardstack/ identifier)',
    )
    .option(
      '--realm-secret-seed',
      'Administrative auth: prompt for a realm secret seed and mint a JWT locally instead of using a Matrix profile (env: BOXEL_REALM_SECRET_SEED)',
    )
    .option('--json', 'Output raw JSON response')
    .action(async (filePath: string, opts: ReadCliOptions) => {
      let realm = opts.realm;
      let split = splitRealmResourceIdentifier(filePath);
      if (split) {
        if (realm) {
          console.error(
            `${FG_RED}Error:${RESET} Pass either a full @cardstack/ identifier as <path> or --realm with a realm-relative path, not both`,
          );
          process.exit(1);
        }
        ({ realm, path: filePath } = split);
      } else if (!realm) {
        console.error(
          `${FG_RED}Error:${RESET} --realm is required unless <path> is a full @cardstack/ identifier`,
        );
        process.exit(1);
      }

      let result: ReadResult;
      try {
        // Inside the try so a seed-resolution throw (e.g. --realm-secret-seed
        // with non-TTY stdin) surfaces as a clean error, not an unhandled one.
        let realmSecretSeed = await resolveRealmSecretSeed(
          opts.realmSecretSeed === true,
        );
        result = await read(realm, filePath, { realmSecretSeed });
      } catch (err) {
        console.error(
          `${FG_RED}Error:${RESET} ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }

      if (opts.json) {
        let serializable: Record<string, unknown> = {
          ok: result.ok,
          status: result.status,
          error: result.error,
        };
        if (result.content !== undefined) {
          serializable.content = result.content;
        }
        if (result.bytes !== undefined) {
          // Buffer.from(typedArray) shares memory, then toString('base64')
          // copies into a base64 string — fine for the JSON output path.
          serializable.bytesBase64 = Buffer.from(
            result.bytes.buffer,
            result.bytes.byteOffset,
            result.bytes.byteLength,
          ).toString('base64');
        }
        cliLog.output(JSON.stringify(serializable, null, 2));
      } else if (result.ok) {
        if (result.bytes !== undefined) {
          process.stdout.write(result.bytes);
        } else {
          cliLog.output(result.content ?? '');
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
