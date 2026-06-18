import { isCardInstance } from '@cardstack/runtime-common';

import type { MarkdownDef } from 'https://cardstack.com/base/markdown-file-def';
import type * as SkillModule from 'https://cardstack.com/base/skill';

import { isSkillCard } from './file-def-manager';

import type StoreService from '../services/store';

// A skill is either a `Skill` card (commands on `Skill.commands`) or a
// markdown file whose `boxel.kind: skill` frontmatter rehydrates as a
// `SkillFrontmatterField` (commands on `MarkdownDef.frontmatter.commands`).
// Both `commands` fields are `containsMany(CommandField)`, so once gathered the
// `CommandField` instances feed the command-definition upload flow identically.
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

// Returns the `CommandField` instances a skill source contributes, regardless
// of whether the source is a `Skill` card or a skill-bearing markdown file.
export function getSkillSourceCommands(
  instance: SkillSource | null | undefined,
): SkillModule.CommandField[] {
  if (isSkillCardInstance(instance)) {
    return instance.commands ?? [];
  }
  if (isSkillMarkdown(instance)) {
    // For `boxel.kind: skill`, `frontmatter` is a `SkillFrontmatterField` whose
    // `commands` is the same `containsMany(CommandField)` as `Skill.commands`.
    let frontmatter = instance.frontmatter as {
      commands?: SkillModule.CommandField[];
    } | null;
    return frontmatter?.commands ?? [];
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
