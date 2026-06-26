import { logger, SupportedMimeType } from '@cardstack/runtime-common';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';
import { DelegatedRealmSessionError } from '@cardstack/runtime-common/user-delegated-realm-server-session';
import type { Tool } from 'https://cardstack.com/base/matrix-event';
import type { DelegatedRealmSessionManager } from './user-delegated-realm-server-session.ts';

let log = logger('ai-bot:load-skill');

export const LOAD_SKILL_TOOL_NAME = 'loadSkill';

// Tier 2/3 of the pull model (CS-11554). The model calls `loadSkill` to pull a
// skill's full instructions on demand instead of having every skill body pushed
// into the prompt up front. ai-bot executes it in-process: it mints a
// delegated, user-scoped realm token (CS-11553) and fetches the file over HTTP,
// so the bot can only read what the requesting human can already read, and the
// content is always live (no Matrix snapshots, no host round-trip).
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
    delegatedRealmSessions: Pick<DelegatedRealmSessionManager, 'getToken'>;
    fetch?: typeof globalThis.fetch;
  },
): Promise<LoadSkillResult> {
  let url = skillFileUrl(args);

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
          ok: false,
          error: 'skill loading is unavailable (delegation is not configured)',
        };
      }
      if (e.kind === 'forbidden') {
        return { ok: false, error: `no read access to ${args.realm}` };
      }
    }
    log.error(
      `loadSkill: could not obtain a delegated token for ${args.realm}: ${
        e?.message ?? e
      }`,
    );
    return {
      ok: false,
      error: `could not obtain realm access for ${args.realm}`,
    };
  }

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: SupportedMimeType.CardSource,
        Authorization: `Bearer ${token}`,
      },
    });
  } catch (e: any) {
    log.error(`loadSkill: fetch failed for ${url}: ${e?.message ?? e}`);
    return { ok: false, error: `could not fetch ${url}` };
  }

  if (!response.ok) {
    return {
      ok: false,
      error: `could not load ${url} (HTTP ${response.status})`,
    };
  }

  return { ok: true, url, content: await response.text() };
}
