import type { Command } from 'commander';
import {
  getProfileManager,
  type ProfileManager,
} from '../lib/profile-manager.ts';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';
import { FG_RED, DIM, RESET } from '../lib/colors.ts';
import { cliLog } from '../lib/cli-log.ts';

export interface ReadTranspiledResult {
  ok: boolean;
  status?: number;
  /** Transpiled JavaScript output as text. */
  content?: string;
  error?: string;
}

export interface ReadTranspiledOptions {
  profileManager?: ProfileManager;
}

interface ReadTranspiledCliOptions {
  realm: string;
  json?: boolean;
}

/**
 * Fetch the TRANSPILED JavaScript output for a realm module.
 *
 * Runtime evaluation errors carry line/column references that point to
 * the transpiled output, not the raw .gts source — this lets callers
 * inspect what the realm actually compiled. The realm accepts the
 * module path either with or without the `.gts` extension and returns
 * the compiled JS when fetched with `Accept: *\/*`.
 *
 * Uses the per-realm JWT via `ProfileManager.authedRealmFetch`.
 */
export async function readTranspiledModule(
  realmUrl: string,
  modulePath: string,
  options?: ReadTranspiledOptions,
): Promise<ReadTranspiledResult> {
  let pm = options?.profileManager ?? getProfileManager();
  let active = pm.getActiveProfile();
  if (!active) {
    throw new Error(
      'No active profile. Run `boxel profile add` to create one.',
    );
  }

  let url = new URL(modulePath, ensureTrailingSlash(realmUrl)).href;

  let response: Response;
  try {
    response = await pm.authedRealmFetch(url, {
      method: 'GET',
      headers: { Accept: '*/*' },
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
  return { ok: true, status: response.status, content: text };
}

export function registerReadTranspiledCommand(program: Command): void {
  program
    .command('read-transpiled')
    .description(
      "Debugging tool ONLY for investigating runtime errors in .gts modules you've written. " +
        'Use when an eval or instantiate error reports a line/column number — those line ' +
        'numbers refer to the transpiled output, not your .gts source, so fetching the ' +
        'transpiled output is how you locate the offending source construct. Never use the ' +
        'transpiled output as a reference for how to write code: do not copy its patterns ' +
        '(setComponentTemplate, precompileTemplate, wire-format templates, base64 CSS ' +
        'imports) into source. Always write idiomatic Ember / <template>-tag / CardDef source.',
    )
    .argument(
      '<path>',
      'Realm-relative module path. The .gts extension is optional — the realm accepts either form.',
    )
    .requiredOption('--realm <realm-url>', 'The realm URL to fetch from')
    .option('--json', 'Output raw JSON response')
    .action(async (modulePath: string, opts: ReadTranspiledCliOptions) => {
      let result: ReadTranspiledResult;
      try {
        result = await readTranspiledModule(opts.realm, modulePath);
      } catch (err) {
        console.error(
          `${FG_RED}Error:${RESET} ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }

      if (opts.json) {
        cliLog.output(JSON.stringify(result, null, 2));
      } else if (result.ok) {
        cliLog.output(result.content ?? '');
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
