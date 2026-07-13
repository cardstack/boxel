import { logger, SupportedMimeType } from '@cardstack/runtime-common';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';
import { DelegatedUserRealmSessionError } from '@cardstack/runtime-common/user-delegated-realm-server-session';
import type { Tool } from '@cardstack/base/matrix-event';
import type {
  ChatCompletion,
  ChatCompletionMessageToolCall,
} from 'openai/resources';
import type { DelegatedUserRealmSessionManager } from './user-delegated-realm-server-session.ts';

let log = logger('ai-bot:read-realm-file');

export const READ_REALM_FILE_TOOL_NAME = 'readRealmFile';

// On-demand file reading. The model calls `readRealmFile` to pull files'
// contents only when it needs them — most often a skill's SKILL.md or the
// references it lists, but it works for any file in the realm. One call reads
// any number of files: each model turn that requests reads costs a full
// round-trip (fulfillment + a fresh generation), so the tool takes a list and
// the description pushes the model to batch everything it already knows it
// needs. ai-bot executes it in-process: it mints a delegated, user-scoped
// realm token and fetches each file over HTTP, so the bot can only read what
// the requesting human can already read, and the content is always live (no
// Matrix snapshots, no host round-trip).
export const readRealmFileTool: Tool = {
  type: 'function',
  function: {
    name: READ_REALM_FILE_TOOL_NAME,
    description:
      "Read files from a realm on demand — e.g. a skill's SKILL.md, or the " +
      'reference files it lists. Reads all the given URLs at once, so when ' +
      'you already know several files you need (a skill’s reference ' +
      'list usually tells you), request them all in a single call rather ' +
      'than a few at a time — every extra round of reads delays your answer.',
    parameters: {
      type: 'object',
      properties: {
        urls: {
          type: 'array',
          minItems: 1,
          items: { type: 'string' },
          description:
            'Full URLs of the files to read, each exactly as it appears in ' +
            "the skill (a link there is already absolute — don't shorten " +
            'or rewrite it). The realm each file lives in is worked out ' +
            'for you.',
        },
      },
      required: ['urls'],
    },
  },
};

export interface ReadRealmFileArgs {
  // Full URLs of the files to read. The realm each belongs to is discovered
  // from the realm server's response, so the caller supplies only URLs.
  urls: string[];
}

// Realm servers echo the owning realm's root on every response — success or
// auth failure — via this header. Reading it lets us discover the realm from
// the file URL alone, so a delegated token is minted for the right realm
// without the model having to name it (and get it wrong).
const REALM_URL_HEADER = 'x-boxel-realm-url';

export type ReadRealmFileResult =
  | { ok: true; url: string; content: string }
  | { ok: false; error: string };

// Reads one of a readRealmFile call's files inside the bot process: GETs the
// file as raw source, discovering the owning realm from the response so a
// delegated, read-only token can be minted for `onBehalfOf` only when the
// realm actually gates the file. A public file (e.g. anything in the skills
// realm) is returned from the first unauthenticated fetch with no token at
// all. Never throws — returns a result the caller hands back to the model as
// part of the tool result, so a missing file or a permission failure becomes
// information the model can act on rather than a crashed turn.
export async function executeReadRealmFile(
  url: string,
  {
    onBehalfOf,
    delegatedUserRealmSessions,
    fetch = globalThis.fetch,
  }: {
    onBehalfOf: string;
    delegatedUserRealmSessions: Pick<
      DelegatedUserRealmSessionManager,
      'getToken' | 'invalidate'
    >;
    fetch?: typeof globalThis.fetch;
  },
): Promise<ReadRealmFileResult> {
  // `redirect: 'manual'` keeps a stray redirect from being silently followed
  // (it surfaces as a non-2xx instead). No Authorization on the first try:
  // public files (the skills realm) come back 200, and a gated file comes back
  // 401/403 while still telling us its realm via the response header.
  let get = async (token?: string): Promise<Response> =>
    fetch(url, {
      redirect: 'manual',
      headers: {
        Accept: SupportedMimeType.CardSource,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

  let response: Response;
  try {
    response = await get();
  } catch (e: any) {
    log.error(`readRealmFile: fetch failed for ${url}: ${e?.message ?? e}`);
    return { ok: false, error: `could not fetch ${url}` };
  }

  // Public read (or an already-authorized cache/CDN hit): done, no token.
  if (response.ok) {
    return { ok: true, url, content: await response.text() };
  }

  // Anything other than an auth challenge is a real failure (404, 302, …).
  if (response.status !== 401 && response.status !== 403) {
    return {
      ok: false,
      error: `could not load ${url} (HTTP ${response.status})`,
    };
  }

  // Gated file: the realm server named the owning realm even on the 401/403.
  let realmHeader = response.headers.get(REALM_URL_HEADER);
  if (!realmHeader) {
    return {
      ok: false,
      error: `could not determine which realm ${url} belongs to`,
    };
  }
  let realm = ensureTrailingSlash(realmHeader);

  // The header is only trustworthy as a claim about the responding host
  // itself: the token minted below is sent with the retry to `url`, and the
  // mint handshake goes to the realm's origin. Requiring the file to live
  // inside the realm that claimed it keeps both on the origin that issued the
  // challenge — otherwise a hostile host could name someone else's realm in
  // the header and receive that realm's delegated token on the retry.
  if (!url.startsWith(realm)) {
    return {
      ok: false,
      error: `could not load ${url}: it does not belong to the realm that claimed it (${realm})`,
    };
  }

  let authorized = async (): Promise<{
    response?: Response;
    error?: string;
  }> => {
    let token: string;
    try {
      token = await delegatedUserRealmSessions.getToken({ onBehalfOf, realm });
    } catch (e: any) {
      if (e instanceof DelegatedUserRealmSessionError) {
        if (e.kind === 'disabled') {
          return {
            error:
              'reading realm files is unavailable (delegation is not configured)',
          };
        }
        if (e.kind === 'forbidden') {
          return { error: `no read access to ${realm}` };
        }
      }
      log.error(
        `readRealmFile: could not obtain a delegated token for ${realm}: ${
          e?.message ?? e
        }`,
      );
      return { error: `could not obtain realm access for ${realm}` };
    }
    try {
      return { response: await get(token) };
    } catch (e: any) {
      log.error(`readRealmFile: fetch failed for ${url}: ${e?.message ?? e}`);
      return { error: `could not fetch ${url}` };
    }
  };

  let { response: authed, error } = await authorized();
  if (error) {
    return { ok: false, error };
  }
  // A cached token whose access was revoked inside its staleness window gets a
  // 401/403. Drop it and try once with a freshly minted token before failing.
  if (authed && (authed.status === 401 || authed.status === 403)) {
    delegatedUserRealmSessions.invalidate({ onBehalfOf, realm });
    ({ response: authed, error } = await authorized());
    if (error) {
      return { ok: false, error };
    }
  }

  if (!authed || !authed.ok) {
    return {
      ok: false,
      error: `could not load ${url} (HTTP ${authed?.status ?? 'unknown'})`,
    };
  }

  return { ok: true, url, content: await authed.text() };
}

export interface ClassifiedToolCalls {
  // Tool calls ai-bot runs itself (readRealmFile).
  botToolCalls: ChatCompletionMessageToolCall[];
  // Tool calls the host runs (everything else).
  hostToolCalls: ChatCompletionMessageToolCall[];
}

// Split a completion's tool calls into the ones ai-bot fulfills itself
// (readRealmFile) and the ones the host fulfills. Both kinds now resolve the
// same way — as command requests answered by a command-result event on a later
// turn — so a single response may freely contain both; the caller fulfills the
// bot ones and leaves the rest to the host.
export function classifyToolCalls(
  assistantMessage: ChatCompletion.Choice['message'],
): ClassifiedToolCalls {
  let botToolCalls: ChatCompletionMessageToolCall[] = [];
  let hostToolCalls: ChatCompletionMessageToolCall[] = [];
  for (let call of assistantMessage.tool_calls ?? []) {
    if (
      call.type === 'function' &&
      call.function.name === READ_REALM_FILE_TOOL_NAME
    ) {
      botToolCalls.push(call);
    } else {
      hostToolCalls.push(call);
    }
  }
  return { botToolCalls, hostToolCalls };
}

// A short human label for a file being read, derived from its URL:
// `…/skills/<name>/SKILL.md` → `<name>/SKILL.md`, otherwise the file name.
// Shown in the command-result indicator so the user sees which file was read.
export function fileLabelFromUrl(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }
  try {
    let segments = new URL(url).pathname.split('/').filter(Boolean);
    let last = segments[segments.length - 1];
    if (last === 'SKILL.md' && segments.length >= 2) {
      return `${segments[segments.length - 2]}/SKILL.md`;
    }
    return last ?? url;
  } catch {
    return url;
  }
}

// A readRealmFile call can batch many urls; cap how many we name in the
// timeline label so the description (and the event payload it rides in) stays
// bounded no matter how many files the model requests at once.
const READ_FILES_LABEL_MAX = 5;

// Build the human-readable timeline label ("Read file: <name>" /
// "Read files: <names>") from a readRealmFile call's `urls` argument. Non-string
// entries are dropped so a malformed argument never leaks into the label.
export function readFilesLabel(urls: unknown): string {
  let labels = (Array.isArray(urls) ? urls : [])
    .filter((url): url is string => typeof url === 'string')
    .map((url) => fileLabelFromUrl(url))
    .filter((label): label is string => Boolean(label));
  if (labels.length === 0) {
    return 'Read files';
  }
  if (labels.length === 1) {
    return `Read file: ${labels[0]}`;
  }
  let shown = labels.slice(0, READ_FILES_LABEL_MAX);
  let remaining = labels.length - shown.length;
  let suffix = remaining > 0 ? `, and ${remaining} more` : '';
  return `Read files: ${shown.join(', ')}${suffix}`;
}
