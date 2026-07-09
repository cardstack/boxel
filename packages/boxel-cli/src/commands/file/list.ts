import type { Command } from 'commander';
import {
  getProfileManager,
  NO_ACTIVE_PROFILE_ERROR,
  type ProfileManager,
} from '../../lib/profile-manager.ts';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';
import { SupportedMimeType } from '@cardstack/runtime-common/supported-mime-type';
import { FG_RED, DIM, RESET } from '../../lib/colors.ts';
import { cliLog } from '../../lib/cli-log.ts';
import { resolveRealmIdentifier } from '../../lib/resolve-realm-identifier.ts';

export interface ListFilesResult {
  filenames: string[];
  error?: string;
}

export interface ListFilesCommandOptions {
  profileManager?: ProfileManager;
}

interface ListFilesCliOptions {
  realm: string;
  json?: boolean;
}

/**
 * List all file paths in a realm via the `_mtimes` endpoint.
 * Returns relative paths (e.g., `hello.gts`, `Cards/my-card.json`).
 */
export async function listFiles(
  realmUrl: string,
  options?: ListFilesCommandOptions,
): Promise<ListFilesResult> {
  let pm = options?.profileManager ?? getProfileManager();
  let active = pm.getActiveProfile();
  if (!active) {
    return {
      filenames: [],
      error: NO_ACTIVE_PROFILE_ERROR,
    };
  }

  let resolvedRealm = resolveRealmIdentifier(realmUrl, { profileManager: pm });
  if (!resolvedRealm.ok) {
    return { filenames: [], error: resolvedRealm.error };
  }
  realmUrl = resolvedRealm.url;

  let normalizedRealmUrl = ensureTrailingSlash(realmUrl);
  let mtimesUrl = `${normalizedRealmUrl}_mtimes`;

  try {
    let response = await pm.authedRealmFetch(mtimesUrl, {
      method: 'GET',
      headers: { Accept: SupportedMimeType.Mtimes },
    });

    if (!response.ok) {
      let body = await response.text().catch(() => '(no body)');
      return {
        filenames: [],
        error: `_mtimes returned HTTP ${response.status}: ${body.slice(0, 300)}`,
      };
    }

    let json = (await response.json()) as {
      data?: { attributes?: { mtimes?: Record<string, number> } };
    };
    let mtimes =
      json?.data?.attributes?.mtimes ??
      (json as unknown as Record<string, number>);

    let filenames: string[] = [];
    for (let fullUrl of Object.keys(mtimes)) {
      if (!fullUrl.startsWith(normalizedRealmUrl)) {
        continue;
      }
      let relativePath = fullUrl.slice(normalizedRealmUrl.length);
      if (!relativePath || relativePath.endsWith('/')) {
        continue;
      }
      filenames.push(relativePath);
    }

    return { filenames: filenames.sort() };
  } catch (err) {
    return {
      filenames: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function registerListCommand(file: Command): void {
  file
    .command('list')
    .alias('ls')
    .description('List all files in a realm')
    .requiredOption('--realm <realm-url>', 'The realm URL to list files from')
    .option('--json', 'Output raw JSON response')
    .action(async (opts: ListFilesCliOptions) => {
      let result: ListFilesResult;
      try {
        result = await listFiles(opts.realm);
      } catch (err) {
        console.error(
          `${FG_RED}Error:${RESET} ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }

      if (opts.json) {
        cliLog.output(JSON.stringify(result, null, 2));
        if (result.error) {
          process.exit(1);
        }
      } else if (result.error) {
        console.error(`${FG_RED}Error:${RESET} ${result.error}`);
        process.exit(1);
      } else {
        for (let filename of result.filenames) {
          console.log(`${DIM}${filename}${RESET}`);
        }
        console.log(`\n${DIM}${result.filenames.length} file(s)${RESET}`);
      }
    });
}
