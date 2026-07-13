import { isCardInstance, isMarkdownFile } from '@cardstack/runtime-common';
import {
  isToolResultEventType,
  isToolResultWithOutputContent,
} from '@cardstack/runtime-common/matrix-constants';

import { isSkillCard } from './file-def-manager';

import type StoreService from '../services/store';
import type { MarkdownDef } from '@cardstack/base/markdown-file-def';
import type {
  DiscoveredToolDefinition,
  MatrixEvent as DiscreteMatrixEvent,
  ToolResultEvent,
} from '@cardstack/base/matrix-event';
import type * as SkillModule from '@cardstack/base/skill';

// A skill is either a `Skill` card (commands on `Skill.commands`) or a
// markdown file whose `boxel.kind: skill` frontmatter rehydrates as a
// `SkillFrontmatterField` (tools on `MarkdownDef.frontmatter.tools`).
// Both fields are `containsMany(ToolField)`, so once gathered the
// `ToolField` instances feed the command-definition upload flow identically.
export type SkillSource = SkillModule.Skill | MarkdownDef;

// A markdown skill carries its kind on the indexed `MarkdownDef.kind` field.
export const SKILL_MARKDOWN_KIND = 'skill';

function isSkillCardInstance(instance: unknown): instance is SkillModule.Skill {
  return (
    typeof instance === 'object' && instance !== null && isSkillCard in instance
  );
}

function isSkillMarkdown(instance: unknown): instance is MarkdownDef {
  return (
    typeof instance === 'object' &&
    instance !== null &&
    (instance as MarkdownDef).kind === SKILL_MARKDOWN_KIND
  );
}

export function isSkillSource(instance: unknown): instance is SkillSource {
  return isSkillCardInstance(instance) || isSkillMarkdown(instance);
}

// Returns the `ToolField` instances a skill source contributes, regardless
// of whether the source is a `Skill` card or a skill-bearing markdown file.
export function getSkillSourceTools(
  instance: SkillSource | null | undefined,
): SkillModule.ToolField[] {
  if (isSkillCardInstance(instance)) {
    return instance.commands ?? [];
  }
  if (isSkillMarkdown(instance)) {
    // For `boxel.kind: skill`, `frontmatter` is a `SkillFrontmatterField` whose
    // `tools` is the same `containsMany(ToolField)` as `Skill.commands`.
    // Index rows extracted before the command → tool rename carry the value
    // under the legacy `commands` field instead; fall back until all realms
    // have reindexed.
    let frontmatter = instance.frontmatter as {
      tools?: SkillModule.ToolField[];
      commands?: SkillModule.ToolField[];
    } | null;
    // `tools` is a containsMany, so a rehydrated pre-rename row yields [] (not
    // undefined) — an empty-check, not `??`, is what routes to the fallback.
    let tools = frontmatter?.tools;
    return tools?.length ? tools : (frontmatter?.commands ?? []);
  }
  return [];
}

// True for ids that name a markdown file (skills live in `*.md` / `*.markdown`
// files). Such ids load through the `file-meta` read type rather than as
// cards. Skill-flavored spelling of the shared markdown-file predicate.
export function isMarkdownSkillId(id: string): boolean {
  return isMarkdownFile(id);
}

// Loads a skill by id, dispatching markdown files to the `file-meta` read type
// and everything else to the card read type. Returns the instance only when it
// is actually a skill source; otherwise `undefined`.
export async function loadSkillSource(
  store: StoreService,
  id: string,
): Promise<SkillSource | undefined> {
  if (isMarkdownSkillId(id)) {
    let fileMeta = await store.get<MarkdownDef>(id, { type: 'file-meta' });
    return isSkillMarkdown(fileMeta) ? fileMeta : undefined;
  }
  let card = await store.get<SkillModule.Skill>(id);
  return isCardInstance(card) && isSkillCardInstance(card) ? card : undefined;
}

// Synchronous, cache-only variant for code paths that already require loaded
// instances (e.g. computing the room's usable commands).
export function peekSkillSource(
  store: StoreService,
  id: string,
): SkillSource | undefined {
  if (isMarkdownSkillId(id)) {
    let fileMeta = store.peek<MarkdownDef>(id, { type: 'file-meta' });
    return isSkillMarkdown(fileMeta) ? fileMeta : undefined;
  }
  let card = store.peek<SkillModule.Skill>(id);
  return isCardInstance(card) && isSkillCardInstance(card) ? card : undefined;
}

// The declaring-skill hint for a tool the model discovered by reading a
// skill file: the latest readRealmFile result event whose
// `data.discoveredTools` names this function returns that entry's
// `sourceSkillUrl`. The hint only says where to look — a caller must
// re-derive the codeRef from that skill's realm-indexed frontmatter (see
// `message-builder`) before executing anything, so a forged or stale
// annotation can point at a skill but never make it declare a tool it
// doesn't have.
export function findDiscoveredToolSkillUrl(
  events: DiscreteMatrixEvent[],
  functionName: string,
): string | undefined {
  let found: string | undefined;
  for (let event of events) {
    if (!isToolResultEventType(event.type)) {
      continue;
    }
    let content = (event as ToolResultEvent).content;
    if (!isToolResultWithOutputContent(content)) {
      continue;
    }
    let discovered = content.data?.discoveredTools;
    if (!Array.isArray(discovered)) {
      continue;
    }
    for (let def of discovered as DiscoveredToolDefinition[]) {
      if (!def?.sourceSkillUrl) {
        continue;
      }
      if (
        def.definition?.function?.name === functionName ||
        def.functionName === functionName
      ) {
        // Keep scanning: events are chronological, and the latest read of a
        // skill is the freshest claim about where the tool lives.
        found = def.sourceSkillUrl;
      }
    }
  }
  return found;
}
