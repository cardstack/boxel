import type { Command } from 'commander';
import {
  getProfileManager,
  NO_ACTIVE_PROFILE_ERROR,
  type ProfileManager,
} from '../../lib/profile-manager.ts';
import { isProtectedFile } from '../../lib/realm-sync-base.ts';
import { listFiles } from './list.ts';
import { read } from './read.ts';
import { write } from './write.ts';
import { FG_GREEN, FG_RED, DIM, RESET } from '../../lib/colors.ts';
import { resolveRealmIdentifier } from '../../lib/resolve-realm-identifier.ts';

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

  let resolvedRealm = resolveRealmIdentifier(realmUrl, { profileManager: pm });
  if (!resolvedRealm.ok) {
    return {
      ok: false,
      touched: [],
      skipped: [],
      error: resolvedRealm.error,
    };
  }
  realmUrl = resolvedRealm.url;

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
    let listed = await listFiles(realmUrl, { profileManager: pm });
    if (listed.error) {
      return {
        ok: false,
        touched: [],
        skipped: [],
        error: listed.error,
      };
    }
    targets = listed.filenames.filter(
      (p) => (p.endsWith('.json') || p.endsWith('.gts')) && !isProtectedFile(p),
    );
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

    if (isProtectedFile(path)) {
      skipped.push({ path, reason: 'protected file' });
      continue;
    }

    let readResult = await read(realmUrl, path, { profileManager: pm });
    if (!readResult.ok || readResult.content == null) {
      skipped.push({ path, reason: readResult.error ?? 'read failed' });
      continue;
    }

    if (options?.dryRun) {
      touched.push(path);
      continue;
    }

    let next = path.endsWith('.json')
      ? touchJson(readResult.content)
      : touchGts(readResult.content);

    let writeResult = await write(realmUrl, path, next, {
      profileManager: pm,
    });
    if (!writeResult.ok) {
      skipped.push({ path, reason: writeResult.error ?? 'write failed' });
      continue;
    }

    touched.push(path);
  }

  return { ok: skipped.length === 0, touched, skipped };
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
  return content.endsWith('\n\n') ? content.slice(0, -1) : content + '\n';
}

function touchGts(content: string): string {
  // Only strip the dedicated trailing marker line we ourselves appended,
  // so occurrences inside string literals or unrelated comments are left
  // untouched and the mutation stays semantically neutral.
  let trailingMarker = `\n${TOUCH_COMMENT}\n`;
  if (content.endsWith(trailingMarker)) {
    return content.slice(0, -trailingMarker.length) + '\n';
  }
  return content.endsWith('\n')
    ? content + TOUCH_COMMENT + '\n'
    : content + '\n' + TOUCH_COMMENT + '\n';
}

export function registerTouchCommand(parent: Command): void {
  parent
    .command('touch')
    .description(
      'Force realm re-indexing of one or more files by making a semantically-neutral edit. ' +
        '--all touches every .json/.gts in the realm without confirmation; use with care.',
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
