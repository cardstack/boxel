import type { Command } from 'commander';
import {
  getProfileManager,
  NO_ACTIVE_PROFILE_ERROR,
  type ProfileManager,
} from '../../lib/profile-manager.ts';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';
import { SupportedMimeType } from '@cardstack/runtime-common/supported-mime-type';
import { FG_GREEN, FG_RED, RESET } from '../../lib/colors.ts';
import { cliLog } from '../../lib/cli-log.ts';
import { resolveRealmIdentifier } from '../../lib/resolve-realm-identifier.ts';

export interface IndexingErrorsCommandOptions {
  profileManager?: ProfileManager;
}

// Resource for a row with `has_error = TRUE`: render/extract failed and
// the persisted SerializedError carries the cause.
export interface IndexingErrorEntry {
  type: 'indexing-error';
  id: string;
  attributes: {
    url: string;
    entryType: string;
    errorDoc: SerializedErrorLike | null;
    diagnostics: Record<string, unknown> | null;
    brokenLinks?: BrokenLinkLike[];
  };
}

// Resource for a row that indexed cleanly but holds broken
// linksTo / linksToMany targets surfaced via `diagnostics.brokenLinks`.
export interface BrokenLinkEntry {
  type: 'broken-link';
  id: string;
  attributes: {
    url: string;
    entryType: string;
    diagnostics: Record<string, unknown> | null;
    brokenLinks: BrokenLinkLike[];
  };
}

// Resource for a row that indexed cleanly but whose YAML frontmatter wouldn't
// parse, surfaced via `diagnostics.frontmatterParseError`. The file indexes
// body-only; anything the frontmatter declared (e.g. a skill's commands) was
// dropped.
export interface FrontmatterErrorEntry {
  type: 'frontmatter-error';
  id: string;
  attributes: {
    url: string;
    entryType: string;
    diagnostics: Record<string, unknown> | null;
    frontmatterParseError: FrontmatterParseErrorLike;
  };
}

export type IndexingErrorsEntry =
  | IndexingErrorEntry
  | BrokenLinkEntry
  | FrontmatterErrorEntry;

export interface IndexingErrorsDocument {
  data: IndexingErrorsEntry[];
}

// Mirror of BrokenLinkSummary from @cardstack/runtime-common, kept local
// to avoid pulling the runtime-common barrel into the CLI bundle.
export interface BrokenLinkLike {
  fieldName: string;
  reference: string;
  kind: 'error' | 'not-found';
}

// Mirror of FrontmatterParseError from @cardstack/runtime-common, kept local
// for the same reason.
export interface FrontmatterParseErrorLike {
  message: string;
  line?: number;
  column?: number;
}

export interface IndexingErrorsResult {
  ok: boolean;
  document?: IndexingErrorsDocument;
  error?: string;
}

// Subset of SerializedError from @cardstack/runtime-common/error. Kept local
// so the CLI doesn't import the full error module just for a type.
interface SerializedErrorLike {
  message?: string;
  title?: string;
  status?: number;
  [key: string]: unknown;
}

interface IndexingErrorsCliOptions {
  realm: string;
  json?: boolean;
}

const SHORT_MESSAGE_MAX = 100;

export async function indexingErrors(
  realmUrl: string,
  options: IndexingErrorsCommandOptions = {},
): Promise<IndexingErrorsResult> {
  let pm = options.profileManager ?? getProfileManager();
  let active = pm.getActiveProfile();
  if (!active) {
    return { ok: false, error: NO_ACTIVE_PROFILE_ERROR };
  }

  let resolvedRealm = resolveRealmIdentifier(realmUrl, { profileManager: pm });
  if (!resolvedRealm.ok) {
    return { ok: false, error: resolvedRealm.error };
  }
  realmUrl = resolvedRealm.url;

  let endpoint = `${ensureTrailingSlash(realmUrl)}_indexing-errors`;

  try {
    let response = await pm.authedRealmFetch(endpoint, {
      method: 'GET',
      headers: { Accept: SupportedMimeType.JSONAPI },
    });

    if (!response.ok) {
      let body = await response.text().catch(() => '(no body)');
      return {
        ok: false,
        error: `HTTP ${response.status}: ${body.slice(0, 300)}`,
      };
    }

    let document = (await response.json()) as IndexingErrorsDocument;
    return { ok: true, document };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function shortErrorMessage(
  errorDoc: SerializedErrorLike | null | undefined,
): string {
  if (!errorDoc) {
    return '<no error document>';
  }
  let raw = errorDoc.title ?? errorDoc.message ?? '<no message>';
  let collapsed = raw.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= SHORT_MESSAGE_MAX) {
    return collapsed;
  }
  return `${collapsed.slice(0, SHORT_MESSAGE_MAX - 1)}…`;
}

export function registerIndexingErrorsCommand(realm: Command): void {
  realm
    .command('indexing-errors')
    .description(
      'List every card or module in a realm whose latest indexing attempt errored',
    )
    .requiredOption('--realm <realm-url>', 'The realm URL to query')
    .option('--json', 'Output the full JSON-API document')
    .action(async (opts: IndexingErrorsCliOptions) => {
      let result = await indexingErrors(opts.realm, {});

      if (opts.json) {
        // Emit a discriminated payload on the error branch so a consumer
        // reading only stdout can tell "request failed" apart from "the
        // realm is healthy". Mirroring the failure on stderr + exit(1)
        // keeps the signal for humans and shell scripts.
        if (!result.ok) {
          cliLog.output(JSON.stringify({ error: result.error }, null, 2));
          console.error(`${FG_RED}Error:${RESET} ${result.error}`);
          process.exit(1);
        }
        cliLog.output(JSON.stringify(result.document ?? { data: [] }, null, 2));
        return;
      }

      if (!result.ok) {
        console.error(`${FG_RED}Error:${RESET} ${result.error}`);
        process.exit(1);
      }

      let entries = result.document?.data ?? [];
      if (entries.length === 0) {
        console.log(`${FG_GREEN}No indexing errors.${RESET}`);
        return;
      }

      console.log(
        `${FG_GREEN}${entries.length} indexing finding${
          entries.length === 1 ? '' : 's'
        } for ${opts.realm}:${RESET}`,
      );
      for (let entry of entries) {
        console.log(formatEntry(entry));
      }
    });
}

export function formatEntry(entry: IndexingErrorsEntry): string {
  let prefix = `[${entry.attributes.entryType}]`;
  let url = entry.attributes.url;
  if (entry.type === 'indexing-error') {
    return `${prefix} ${url}  ${shortErrorMessage(entry.attributes.errorDoc)}`;
  }
  if (entry.type === 'frontmatter-error') {
    return `${prefix} ${url}  ${shortFrontmatterError(
      entry.attributes.frontmatterParseError,
    )}`;
  }
  return `${prefix} ${url}  ${shortBrokenLinks(entry.attributes.brokenLinks)}`;
}

export function shortFrontmatterError(
  parseError: FrontmatterParseErrorLike | null | undefined,
): string {
  if (!parseError) {
    return '<no frontmatter error>';
  }
  let where =
    typeof parseError.line === 'number'
      ? ` (line ${parseError.line}${
          typeof parseError.column === 'number' ? `:${parseError.column}` : ''
        })`
      : '';
  let raw = (parseError.message ?? '<no message>').replace(/\s+/g, ' ').trim();
  let message =
    raw.length <= SHORT_MESSAGE_MAX
      ? raw
      : `${raw.slice(0, SHORT_MESSAGE_MAX - 1)}…`;
  return `frontmatter parse error${where}: ${message}`;
}

const BROKEN_LINKS_MAX_LIST = 3;

export function shortBrokenLinks(
  brokenLinks: BrokenLinkLike[] | null | undefined,
): string {
  if (!brokenLinks || brokenLinks.length === 0) {
    return '<no broken links>';
  }
  let preview = brokenLinks
    .slice(0, BROKEN_LINKS_MAX_LIST)
    .map((link) => `${link.fieldName}→${link.reference}`)
    .join(', ');
  let suffix =
    brokenLinks.length > BROKEN_LINKS_MAX_LIST
      ? `, …+${brokenLinks.length - BROKEN_LINKS_MAX_LIST} more`
      : '';
  return `${brokenLinks.length} broken: ${preview}${suffix}`;
}
