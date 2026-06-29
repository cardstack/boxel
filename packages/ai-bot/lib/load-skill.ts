import { logger, SupportedMimeType } from '@cardstack/runtime-common';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';
import { DelegatedUserRealmSessionError } from '@cardstack/runtime-common/user-delegated-realm-server-session';
import type { Tool } from 'https://cardstack.com/base/matrix-event';
import type { DelegatedUserRealmSessionManager } from './user-delegated-realm-server-session.ts';

let log = logger('ai-bot:load-skill');

export const LOAD_SKILL_TOOL_NAME = 'loadSkill';

// On-demand skill loading. The model calls `loadSkill` to pull a skill's full
// instructions only when it needs them, instead of having every skill body
// pushed into the prompt up front. ai-bot executes it in-process: it mints a
// delegated, user-scoped realm token and fetches the file over HTTP, so the bot
// can only read what the requesting human can already read, and the content is
// always live (no Matrix snapshots, no host round-trip).
export const loadSkillTool: Tool = {
  type: 'function',
  function: {
    name: LOAD_SKILL_TOOL_NAME,
    description:
      "Read a skill file on demand: a skill's SKILL.md, or a file it " +
      "references. Use this to get a skill's full instructions, or a reference " +
      'it cites, when you only have it listed.',
    parameters: {
      type: 'object',
      properties: {
        realm: {
          type: 'string',
          description:
            'Realm URL the skill lives in, e.g. https://app.boxel.ai/user/jane/. ' +
            'Scopes the read to that realm; the file must be inside it.',
        },
        url: {
          type: 'string',
          description:
            "Full URL of the file to read — the skill's SKILL.md, or a file it " +
            'references. The realm and these URLs are given to you together.',
        },
      },
      required: ['realm', 'url'],
    },
  },
};

export interface LoadSkillArgs {
  // Realm root the read is scoped to (what the delegated token is minted for).
  realm: string;
  // Full URL of the file to read; must be inside `realm`.
  url: string;
}

export type LoadSkillResult =
  | { ok: true; url: string; content: string }
  | { ok: false; error: string };

// Executes a loadSkill tool call inside the bot process: mints a delegated,
// read-only token for `onBehalfOf` scoped to `realm`, then GETs the skill file
// as raw source. Never throws — returns a result the caller hands back to the
// model as the tool result, so a missing skill or a permission failure becomes
// information the model can act on rather than a crashed turn.
export async function executeLoadSkill(
  args: LoadSkillArgs,
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
): Promise<LoadSkillResult> {
  let url = args.url;

  // The delegated token is scoped to `realm`; a file outside it would be
  // rejected by the realm server anyway, so fail clearly up front.
  if (!url.startsWith(ensureTrailingSlash(args.realm))) {
    return { ok: false, error: `${url} is not inside realm ${args.realm}` };
  }

  // One mint+fetch attempt. `redirect: 'manual'` keeps a stray redirect from
  // being silently followed (it surfaces as a non-2xx instead).
  let attempt = async (): Promise<{ response?: Response; error?: string }> => {
    let token: string;
    try {
      token = await delegatedUserRealmSessions.getToken({
        onBehalfOf,
        realm: args.realm,
      });
    } catch (e: any) {
      if (e instanceof DelegatedUserRealmSessionError) {
        if (e.kind === 'disabled') {
          return {
            error:
              'skill loading is unavailable (delegation is not configured)',
          };
        }
        if (e.kind === 'forbidden') {
          return { error: `no read access to ${args.realm}` };
        }
      }
      log.error(
        `loadSkill: could not obtain a delegated token for ${args.realm}: ${
          e?.message ?? e
        }`,
      );
      return { error: `could not obtain realm access for ${args.realm}` };
    }
    try {
      return {
        response: await fetch(url, {
          redirect: 'manual',
          headers: {
            Accept: SupportedMimeType.CardSource,
            Authorization: `Bearer ${token}`,
          },
        }),
      };
    } catch (e: any) {
      log.error(`loadSkill: fetch failed for ${url}: ${e?.message ?? e}`);
      return { error: `could not fetch ${url}` };
    }
  };

  let { response, error } = await attempt();
  if (error) {
    return { ok: false, error };
  }
  // A cached token whose access was revoked inside its staleness window gets a
  // 401/403. Drop it and try once with a freshly minted token before failing.
  if (response && (response.status === 401 || response.status === 403)) {
    delegatedUserRealmSessions.invalidate({ onBehalfOf, realm: args.realm });
    ({ response, error } = await attempt());
    if (error) {
      return { ok: false, error };
    }
  }

  if (!response || !response.ok) {
    return {
      ok: false,
      error: `could not load ${url} (HTTP ${response?.status ?? 'unknown'})`,
    };
  }

  return { ok: true, url, content: await response.text() };
}
