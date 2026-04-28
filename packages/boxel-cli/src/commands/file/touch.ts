import type { Command } from 'commander';
import {
  getProfileManager,
  NO_ACTIVE_PROFILE_ERROR,
  type ProfileManager,
} from '../../lib/profile-manager';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';
import { SupportedMimeType } from '@cardstack/runtime-common/supported-mime-type';
import { FG_GREEN, FG_RED, DIM, RESET } from '../../lib/colors';

export interface TouchResult {
  ok: boolean;
  touched: string[];
  skipped: { path: string; reason: string }[];
  error?: string;
}

export interface TouchCommandOptions {
  /** When true, enumerate every `.json` and `.gts` file in the realm. */
  all?: boolean;
  /** When true, do not perform any state-changing requests. */
  dryRun?: boolean;
  profileManager?: ProfileManager;
}

interface TouchCliOptions {
  realm: string;
  all?: boolean;
  dryRun?: boolean;
  json?: boolean;
}

const TOUCH_COMMENT = '// touched for re-index';

/**
 * Touch one or more files in a realm to force re-indexing. The touch is a
 * semantically-neutral mutation: a `_touched` timestamp in JSON `meta`,
 * or a toggle of `// touched for re-index` for `.gts` files.
 *
 * Pass `all: true` (with empty `paths`) to touch every `.json` and `.gts`
 * file enumerated via the realm's `_mtimes` endpoint.
 */
export async function touchFiles(
  realmUrl: string,
  paths: string[],
  options?: TouchCommandOptions,
): Promise<TouchResult> {
  let pm = options?.profileManager ?? getProfileManager();
  let active = pm.getActiveProfile();
  if (!active) {
    return {
      ok: false,
      touched: [],
      skipped: [],
      error: NO_ACTIVE_PROFILE_ERROR,
    };
  }

  let normalizedRealmUrl = ensureTrailingSlash(realmUrl);
  let targets: string[];

  if (options?.all) {
    if (paths.length > 0) {
      return {
        ok: false,
        touched: [],
        skipped: [],
        error: 'Cannot pass file paths together with --all',
      };
    }
    let listed = await listTouchableFiles(pm, normalizedRealmUrl);
    if ('error' in listed) {
      return {
        ok: false,
        touched: [],
        skipped: [],
        error: listed.error,
      };
    }
    targets = listed.paths;
  } else {
    if (paths.length === 0) {
      return {
        ok: false,
        touched: [],
        skipped: [],
        error: 'No file paths provided. Pass paths or use --all.',
      };
    }
    targets = paths;
  }

  let touched: string[] = [];
  let skipped: { path: string; reason: string }[] = [];

  for (let path of targets) {
    if (!path.endsWith('.json') && !path.endsWith('.gts')) {
      skipped.push({ path, reason: 'unsupported extension' });
      continue;
    }

    if (options?.dryRun) {
      touched.push(path);
      continue;
    }

    let url = new URL(path, normalizedRealmUrl).href;
    let getResponse: Response;
    try {
      getResponse = await pm.authedRealmFetch(url, {
        method: 'GET',
        headers: { Accept: SupportedMimeType.CardSource },
      });
    } catch (err) {
      skipped.push({
        path,
        reason: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    if (!getResponse.ok) {
      let body = await getResponse.text().catch(() => '(no body)');
      skipped.push({
        path,
        reason: `GET HTTP ${getResponse.status}: ${body.slice(0, 200)}`,
      });
      continue;
    }

    let original = await getResponse.text();
    let next = path.endsWith('.json')
      ? touchJson(original)
      : touchGts(original);

    let putResponse: Response;
    try {
      putResponse = await pm.authedRealmFetch(url, {
        method: 'POST',
        headers: {
          Accept: SupportedMimeType.CardSource,
          'Content-Type': SupportedMimeType.CardSource,
        },
        body: next,
      });
    } catch (err) {
      skipped.push({
        path,
        reason: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    if (!putResponse.ok) {
      let body = await putResponse.text().catch(() => '(no body)');
      skipped.push({
        path,
        reason: `POST HTTP ${putResponse.status}: ${body.slice(0, 200)}`,
      });
      continue;
    }

    touched.push(path);
  }

  return { ok: skipped.length === 0, touched, skipped };
}

async function listTouchableFiles(
  pm: ProfileManager,
  normalizedRealmUrl: string,
): Promise<{ paths: string[] } | { error: string }> {
  let mtimesUrl = `${normalizedRealmUrl}_mtimes`;
  let response: Response;
  try {
    response = await pm.authedRealmFetch(mtimesUrl, {
      method: 'GET',
      headers: { Accept: SupportedMimeType.Mtimes },
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }

  if (!response.ok) {
    let body = await response.text().catch(() => '(no body)');
    return {
      error: `_mtimes returned HTTP ${response.status}: ${body.slice(0, 300)}`,
    };
  }

  let json = (await response.json()) as {
    data?: { attributes?: { mtimes?: Record<string, number> } };
  };
  let mtimes =
    json?.data?.attributes?.mtimes ??
    (json as unknown as Record<string, number>);

  let paths: string[] = [];
  for (let fullUrl of Object.keys(mtimes)) {
    if (!fullUrl.startsWith(normalizedRealmUrl)) {
      continue;
    }
    let relativePath = fullUrl.slice(normalizedRealmUrl.length);
    if (!relativePath || relativePath.endsWith('/')) {
      continue;
    }
    if (relativePath.endsWith('.json') || relativePath.endsWith('.gts')) {
      paths.push(relativePath);
    }
  }
  return { paths: paths.sort() };
}

function touchJson(content: string): string {
  try {
    let data = JSON.parse(content);
    if (data?.data) {
      data.data.meta = { ...(data.data.meta ?? {}), _touched: Date.now() };
      return JSON.stringify(data, null, 2) + '\n';
    }
  } catch {
    // fall through to whitespace toggle
  }
  return toggleTrailingNewline(content);
}

function toggleTrailingNewline(content: string): string {
  if (content.endsWith('\n\n')) {
    return content.slice(0, -1);
  }
  if (content.endsWith('\n')) {
    return content + '\n';
  }
  return content + '\n';
}

function touchGts(content: string): string {
  if (content.includes(TOUCH_COMMENT)) {
    return content.replace(new RegExp(`\\n?${TOUCH_COMMENT}\\n?`, 'g'), '\n');
  }
  return content.endsWith('\n')
    ? content + TOUCH_COMMENT + '\n'
    : content + '\n' + TOUCH_COMMENT + '\n';
}

export function registerTouchCommand(parent: Command): void {
  parent
    .command('touch')
    .description(
      'Force realm re-indexing of one or more files by making a semantically-neutral edit',
    )
    .argument(
      '[paths...]',
      'Realm-relative file path(s) to touch (omit when using --all)',
    )
    .requiredOption('--realm <realm-url>', 'The realm URL to touch files in')
    .option('--all', 'Touch every .json and .gts file in the realm')
    .option('--dry-run', 'Print files that would be touched without writing')
    .option('--json', 'Output raw JSON response')
    .action(async (paths: string[], opts: TouchCliOptions) => {
      let result: TouchResult;
      try {
        result = await touchFiles(opts.realm, paths, {
          all: opts.all,
          dryRun: opts.dryRun,
        });
      } catch (err) {
        console.error(
          `${FG_RED}Error:${RESET} ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else if (result.error) {
        console.error(`${FG_RED}Error:${RESET} ${result.error}`);
      } else {
        let prefix = opts.dryRun ? `${DIM}[dry-run]${RESET} ` : '';
        for (let path of result.touched) {
          console.log(`${prefix}${FG_GREEN}touched${RESET} ${path}`);
        }
        for (let { path, reason } of result.skipped) {
          console.log(
            `${FG_RED}skipped${RESET} ${path} ${DIM}(${reason})${RESET}`,
          );
        }
        let verb = opts.dryRun ? 'would touch' : 'touched';
        console.log(
          `\n${DIM}${verb} ${result.touched.length} file(s)${result.skipped.length > 0 ? `, skipped ${result.skipped.length}` : ''}${RESET}`,
        );
      }

      if (!result.ok) {
        process.exit(1);
      }
    });
}
