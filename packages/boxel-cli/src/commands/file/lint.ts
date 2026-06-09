import type { Command } from 'commander';
import { readFileSync, writeFileSync } from 'fs';
import {
  getProfileManager,
  NO_ACTIVE_PROFILE_ERROR,
  type ProfileManager,
} from '../../lib/profile-manager.ts';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';
import { SupportedMimeType } from '@cardstack/runtime-common/supported-mime-type';
import { FG_GREEN, FG_RED, FG_YELLOW, DIM, RESET } from '../../lib/colors.ts';
import { cliLog } from '../../lib/cli-log.ts';
import { write } from './write.ts';

export interface LintMessage {
  ruleId: string | null;
  severity: 1 | 2;
  message: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
}

export interface LintResult {
  ok: boolean;
  error?: string;
  fixed?: boolean;
  output?: string;
  messages?: LintMessage[];
}

export interface LintCommandOptions {
  profileManager?: ProfileManager;
}

/**
 * Lint a single file's source code via the realm's `_lint` endpoint.
 *
 * Sends the source to `POST <realmUrl>/_lint` with `X-Filename` and
 * `X-HTTP-Method-Override: QUERY` headers. Returns the lint result
 * containing messages and optionally auto-fixed output.
 *
 * Uses the per-realm JWT via `ProfileManager.authedRealmFetch`.
 */
export async function lint(
  realmUrl: string,
  source: string,
  filename: string,
  options?: LintCommandOptions,
): Promise<LintResult> {
  let pm = options?.profileManager ?? getProfileManager();
  let active = pm.getActiveProfile();
  if (!active) {
    return {
      ok: false,
      error: NO_ACTIVE_PROFILE_ERROR,
    };
  }

  let lintUrl = `${ensureTrailingSlash(realmUrl)}_lint`;

  try {
    let response = await pm.authedRealmFetch(lintUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': SupportedMimeType.CardSource,
        'X-Filename': filename,
        'X-HTTP-Method-Override': 'QUERY',
      },
      body: source,
    });

    if (!response.ok) {
      let body = await response.text().catch(() => '(no body)');
      return {
        ok: false,
        error: `HTTP ${response.status}: ${body.slice(0, 300)}`,
      };
    }

    let json = (await response.json()) as {
      fixed: boolean;
      output: string;
      messages: LintMessage[];
    };

    return {
      ok: true,
      fixed: json.fixed,
      output: json.output,
      messages: json.messages,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

interface LintCliOptions {
  realm: string;
  file?: string;
  json?: boolean;
  fix?: boolean;
}

export function registerLintCommand(parent: Command): void {
  parent
    .command('lint')
    .description('Lint a file in a realm using the realm lint endpoint')
    .argument('<path>', 'Realm-relative file path to lint (e.g., my-card.gts)')
    .requiredOption('--realm <realm-url>', 'The realm URL to lint against')
    .option(
      '--file <local-filepath>',
      'Read source from a local file instead of fetching from the realm',
    )
    .option('--json', 'Output raw JSON response')
    .option('--fix', 'Write auto-fixed output back to the source')
    .action(async (filePath: string, opts: LintCliOptions) => {
      let pm = getProfileManager();
      let active = pm.getActiveProfile();
      if (!active) {
        console.error(`${FG_RED}Error:${RESET} ${NO_ACTIVE_PROFILE_ERROR}`);
        process.exit(1);
      }

      let source: string;

      if (opts.file) {
        try {
          source = readFileSync(opts.file, 'utf-8');
        } catch (err) {
          console.error(
            `${FG_RED}Error:${RESET} Could not read local file: ${err instanceof Error ? err.message : String(err)}`,
          );
          process.exit(1);
        }
      } else {
        let readUrl = new URL(filePath, ensureTrailingSlash(opts.realm)).href;
        try {
          let response = await pm.authedRealmFetch(readUrl, {
            method: 'GET',
            headers: { Accept: SupportedMimeType.CardSource },
          });
          if (!response.ok) {
            let body = await response.text().catch(() => '(no body)');
            console.error(
              `${FG_RED}Error:${RESET} Could not read file from realm: HTTP ${response.status}: ${body.slice(0, 300)}`,
            );
            process.exit(1);
          }
          source = await response.text();
        } catch (err) {
          console.error(
            `${FG_RED}Error:${RESET} ${err instanceof Error ? err.message : String(err)}`,
          );
          process.exit(1);
        }
      }

      let result: LintResult;
      try {
        result = await lint(opts.realm, source, filePath, {
          profileManager: pm,
        });
      } catch (err) {
        console.error(
          `${FG_RED}Error:${RESET} ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }

      if (opts.json) {
        cliLog.output(JSON.stringify(result, null, 2));
        if (!result.ok) {
          process.exit(1);
        }
        return;
      }

      if (!result.ok) {
        console.error(`${FG_RED}Error:${RESET} ${result.error}`);
        process.exit(1);
      }

      // Handle --fix: write fixed output back to the source
      if (opts.fix && result.fixed && result.output) {
        if (opts.file) {
          writeFileSync(opts.file, result.output, 'utf-8');
          console.log(`${FG_GREEN}Fixed:${RESET} ${opts.file}`);
        } else {
          let writeResult = await write(opts.realm, filePath, result.output, {
            profileManager: pm,
          });
          if (!writeResult.ok) {
            console.error(
              `${FG_RED}Error:${RESET} Could not write fixed file: ${writeResult.error}`,
            );
            process.exit(1);
          }
          console.log(
            `${FG_GREEN}Fixed:${RESET} ${filePath} ${DIM}→${RESET} ${opts.realm}`,
          );
        }
      }

      let messages = result.messages ?? [];
      let errors = messages.filter((m) => m.severity === 2);
      let warnings = messages.filter((m) => m.severity === 1);

      if (messages.length === 0) {
        console.log(`${DIM}No lint issues found.${RESET}`);
        return;
      }

      for (let msg of messages) {
        let color = msg.severity === 2 ? FG_RED : FG_YELLOW;
        let level = msg.severity === 2 ? 'error' : 'warning';
        let rule = msg.ruleId ? ` (${msg.ruleId})` : '';
        console.log(
          `${color}${level}${RESET} ${msg.line}:${msg.column} ${msg.message}${DIM}${rule}${RESET}`,
        );
      }

      console.log(
        `\n${DIM}${errors.length} error(s), ${warnings.length} warning(s)${RESET}`,
      );

      if (errors.length > 0) {
        process.exit(1);
      }
    });
}
