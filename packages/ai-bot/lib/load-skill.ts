import { logger, SupportedMimeType } from '@cardstack/runtime-common';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';
import { DelegatedRealmSessionError } from '@cardstack/runtime-common/user-delegated-realm-server-session';
import type { Tool } from 'https://cardstack.com/base/matrix-event';
import type { DelegatedRealmSessionManager } from './user-delegated-realm-server-session.ts';

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
      "Load a skill's instructions on demand. Returns the SKILL.md body for a " +
      "skill in a realm, or — with `path` — a single file under the skill's " +
      'references/ directory. Use this to get the full instructions for a skill ' +
      'you have only seen listed by name, or a reference file it cites.',
    parameters: {
      type: 'object',
      properties: {
        realm: {
          type: 'string',
          description:
            'Realm URL the skill lives in, e.g. https://app.boxel.ai/user/jane/. ' +
            'Use a realm advertised in the room or referenced in the conversation.',
        },
        name: {
          type: 'string',
          description:
            'The skill directory name under skills/, e.g. trip-planner.',
        },
        path: {
          type: 'string',
          description:
            "Optional file under the skill's references/ directory, e.g. " +
            'api-notes.md. Omit to load SKILL.md.',
        },
      },
      required: ['realm', 'name'],
    },
  },
};

export interface LoadSkillArgs {
  realm: string;
  name: string;
  path?: string;
}

export type LoadSkillResult =
  | { ok: true; url: string; content: string }
  | { ok: false; error: string };

// The realm file a loadSkill call resolves to: SKILL.md by default, or a single
// file under references/ when `path` is given.
export function skillFileUrl({ realm, name, path }: LoadSkillArgs): string {
  let rel = path
    ? `skills/${name}/references/${path}`
    : `skills/${name}/SKILL.md`;
  return new URL(rel, ensureTrailingSlash(realm)).href;
}

// Upper bound on skill content fed back to the model, so a large references/
// file can't blow up the prompt (and bill) of the following round.
const MAX_SKILL_CONTENT_LENGTH = 100_000;

// Executes a loadSkill tool call inside the bot process: mints a delegated,
// read-only token for `onBehalfOf` scoped to `realm`, then GETs the skill file
// as raw source. Never throws — returns a result the caller hands back to the
// model as the tool result, so a missing skill or a permission failure becomes
// information the model can act on rather than a crashed turn.
export async function executeLoadSkill(
  args: LoadSkillArgs,
  {
    onBehalfOf,
    delegatedRealmSessions,
    fetch = globalThis.fetch,
  }: {
    onBehalfOf: string;
    delegatedRealmSessions: Pick<
      DelegatedRealmSessionManager,
      'getToken' | 'invalidate'
    >;
    fetch?: typeof globalThis.fetch;
  },
): Promise<LoadSkillResult> {
  let url = skillFileUrl(args);

  // One mint+fetch attempt. `redirect: 'manual'` keeps a stray redirect from
  // being silently followed (it surfaces as a non-2xx instead).
  let attempt = async (): Promise<{ response?: Response; error?: string }> => {
    let token: string;
    try {
      token = await delegatedRealmSessions.getToken({
        onBehalfOf,
        realm: args.realm,
      });
    } catch (e: any) {
      if (e instanceof DelegatedRealmSessionError) {
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
    delegatedRealmSessions.invalidate({ onBehalfOf, realm: args.realm });
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

  let content = await response.text();
  if (content.length > MAX_SKILL_CONTENT_LENGTH) {
    content = content.slice(0, MAX_SKILL_CONTENT_LENGTH) + '\n\n…[truncated]';
  }
  return { ok: true, url, content };
}
