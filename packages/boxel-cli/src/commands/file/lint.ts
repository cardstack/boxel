import type { Command } from 'commander';
import { readFileSync } from 'fs';
import {
  getProfileManager,
  type ProfileManager,
} from '../../lib/profile-manager';
import { FG_RED, FG_YELLOW, DIM, RESET } from '../../lib/colors';

const MIME = {
  CardSource: 'application/vnd.card+source',
  JSON: 'application/json',
} as const;

function ensureTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

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
  fixed: boolean;
  output: string;
  messages: LintMessage[];
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
 * Throws on HTTP errors (different from read/write which return error objects).
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
    throw new Error(
      'No active profile. Run `boxel profile add` to create one.',
    );
  }

  let lintUrl = `${ensureTrailingSlash(realmUrl)}_lint`;
  let response = await pm.authedRealmFetch(lintUrl, {
    method: 'POST',
    headers: {
      Accept: MIME.JSON,
      'Content-Type': MIME.CardSource,
      'X-Filename': filename,
      'X-HTTP-Method-Override': 'QUERY',
    },
    body: source,
  });

  if (!response.ok) {
    let body = await response.text().catch(() => '(no body)');
    throw new Error(
      `_lint returned HTTP ${response.status}: ${body.slice(0, 300)}`,
    );
  }

  return (await response.json()) as LintResult;
}

interface LintCliOptions {
  realm: string;
  file?: string;
}

export function registerLintCommand(file: Command): void {
  file
    .command('lint')
    .description('Lint a file in a realm using the realm lint endpoint')
    .argument(
      '<path>',
      'Realm-relative file path to lint (e.g., my-card.gts)',
    )
    .requiredOption('--realm <realm-url>', 'The realm URL to lint against')
    .option(
      '--file <local-filepath>',
      'Read source from a local file instead of fetching from the realm',
    )
    .action(async (filePath: string, opts: LintCliOptions) => {
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
        // Fetch source from realm using read
        let pm = getProfileManager();
        let readUrl = new URL(
          filePath,
          ensureTrailingSlash(opts.realm),
        ).href;
        try {
          let response = await pm.authedRealmFetch(readUrl, {
            method: 'GET',
            headers: { Accept: MIME.CardSource },
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
        result = await lint(opts.realm, source, filePath);
      } catch (err) {
        console.error(
          `${FG_RED}Error:${RESET} ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }

      let errors = result.messages.filter((m) => m.severity === 2);
      let warnings = result.messages.filter((m) => m.severity === 1);

      if (result.messages.length === 0) {
        console.log(`${DIM}No lint issues found.${RESET}`);
        return;
      }

      for (let msg of result.messages) {
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
