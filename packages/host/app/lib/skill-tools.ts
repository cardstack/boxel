import { isCardInstance } from '@cardstack/runtime-common';

import { isSkillCard } from './file-def-manager';

import type StoreService from '../services/store';
import type { MarkdownDef } from '@cardstack/base/markdown-file-def';
import type * as SkillModule from '@cardstack/base/skill';

// A skill is either a `Skill` card (commands on `Skill.commands`) or a
// markdown file whose `boxel.kind: skill` frontmatter rehydrates as a
// `SkillFrontmatterField` (tools on `MarkdownDef.frontmatter.tools`).
// Both fields are `containsMany(ToolField)`, so once gathered the
// `ToolField` instances feed the command-definition upload flow identically.
export type SkillSource = SkillModule.Skill | MarkdownDef;

const MARKDOWN_EXTENSION = /\.(md|markdown)$/i;

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
// files). Such ids load through the `file-meta` read type rather than as cards.
export function isMarkdownSkillId(id: string): boolean {
  let pathname: string;
  try {
    pathname = new URL(id).pathname;
  } catch {
    pathname = id;
  }
  return MARKDOWN_EXTENSION.test(pathname);
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
