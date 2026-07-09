import { service } from '@ember/service';

import { stringify as stringifyYaml } from 'yaml';

import { rri, skillCardRef } from '@cardstack/runtime-common';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';
import type { Skill } from 'https://cardstack.com/base/skill';

import HostBaseCommand from '../lib/host-base-command';

import type CardService from '../services/card-service';
import type RealmService from '../services/realm';
import type StoreService from '../services/store';

// A single command in the migrated frontmatter — the same shape
// `SkillFrontmatterField.tools` (a `containsMany(CommandField)`) parses back
// out of `boxel.tools`.
interface FrontmatterCommand {
  codeRef: { module: string; name: string };
  // Always emitted explicitly. The host auto-executes a command only when
  // `requiresApproval === false` (`command-auto-execute.ts`) and otherwise
  // treats a missing value as `true` (`message-builder.ts`), so dropping an
  // explicit `false` would silently flip an auto-executing command back to
  // approval-required. Preserve the source value, defaulting a missing one to
  // `true` to match that downstream behavior.
  requiresApproval: boolean;
}

// Convert a skill name into a directory-safe slug for `skills/<slug>/SKILL.md`.
function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Last path segment of a card id, minus its extension — a stable slug fallback
// when a skill has no usable name.
function basenameSlug(id: string): string {
  let pathname: string;
  try {
    pathname = new URL(id).pathname;
  } catch {
    pathname = id;
  }
  let name = pathname.split('/').pop() ?? '';
  return slugify(name.replace(/\.[^/.]+$/, ''));
}

export default class MigrateSkillCommand extends HostBaseCommand<
  typeof BaseCommandModule.MigrateSkillInput,
  typeof BaseCommandModule.MigrateSkillResult
> {
  @service declare private cardService: CardService;
  @service declare private realm: RealmService;
  @service declare private store: StoreService;

  description = `Migrate a realm's legacy Skill cards into skills/<name>/SKILL.md \
files with boxel.kind: skill frontmatter.`;
  static actionVerb = 'Migrate';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { MigrateSkillInput } = commandModule;
    return MigrateSkillInput;
  }

  requireInputFields = ['realm'];

  protected async run(
    input: BaseCommandModule.MigrateSkillInput,
  ): Promise<BaseCommandModule.MigrateSkillResult> {
    let realmUrl = this.realm.realmOf(rri(input.realm));
    if (!realmUrl) {
      throw new Error(`Invalid or unknown realm provided: ${input.realm}`);
    }

    // The `type` filter matches the legacy `Skill` card and its subclasses
    // (e.g. `SkillPlus`, `SkillPlusMarkdown`), so every flavour of legacy skill
    // in the realm is migrated.
    let skills = await this.store.search<Skill>(
      { filter: { type: skillCardRef } },
      [realmUrl],
    );

    // Sort by id so slug de-duplication is deterministic: re-running the command
    // assigns the same `-2`/`-3` suffixes in the same order, which keeps the
    // skip-if-exists check stable instead of producing fresh duplicates.
    skills.sort((a, b) => (a.id ?? '').localeCompare(b.id ?? ''));

    let migratedFiles: string[] = [];
    let skippedSkillIds: string[] = [];
    let emptySkillIds: string[] = [];
    let usedSlugs = new Set<string>();

    for (let skill of skills) {
      // Skip — and report — skills with nothing to transcribe rather than
      // writing an empty `SKILL.md`. This guards the markdown-backed subclasses
      // (e.g. `SkillPlusMarkdown`), whose `instructions` is computed from a
      // linked file that may not have resolved in the search result.
      let body = (skill.instructions ?? '').trim();
      if (!body) {
        if (skill.id) {
          emptySkillIds.push(skill.id);
        }
        continue;
      }

      let slug = this.slugForSkill(skill, usedSlugs);
      usedSlugs.add(slug);

      let url = new URL(`skills/${slug}/SKILL.md`, realmUrl);

      if (!input.overwrite && (await this.fileExists(url))) {
        if (skill.id) {
          skippedSkillIds.push(skill.id);
        }
        continue;
      }

      let content = this.buildSkillMarkdown(skill, body);
      await this.cardService.saveSource(
        url,
        content,
        input.overwrite ? 'editor' : 'create-file',
      );
      migratedFiles.push(url.href);
    }

    let commandModule = await this.loadCommandModule();
    const { MigrateSkillResult } = commandModule;
    return new MigrateSkillResult({
      migratedFiles,
      skippedSkillIds,
      emptySkillIds,
    });
  }

  private slugForSkill(skill: Skill, usedSlugs: Set<string>): string {
    let name = skill.cardTitle ?? '';
    let base = slugify(name) || basenameSlug(skill.id ?? '') || 'skill';
    let slug = base;
    let suffix = 2;
    while (usedSlugs.has(slug)) {
      slug = `${base}-${suffix++}`;
    }
    return slug;
  }

  private buildSkillMarkdown(skill: Skill, body: string): string {
    let tools = (skill.commands ?? []).reduce<FrontmatterCommand[]>(
      (acc, command) => {
        let module = command.codeRef?.module;
        let name = command.codeRef?.name;
        if (module && name) {
          acc.push({
            codeRef: { module, name },
            requiresApproval: command.requiresApproval ?? true,
          });
        }
        return acc;
      },
      [],
    );

    // Shared top-level keys (read byte-for-byte by Claude Code) first, then the
    // Boxel-only `boxel:` namespace that carries `kind` and `tools`.
    let frontmatter: Record<string, unknown> = {
      name: skill.cardTitle ?? '',
      description: skill.cardDescription ?? '',
      boxel: {
        kind: 'skill',
        ...(tools.length > 0 ? { tools } : {}),
      },
    };

    return `---\n${stringifyYaml(frontmatter)}---\n\n${body}\n`;
  }

  private async fileExists(url: URL): Promise<boolean> {
    let { status } = await this.cardService.getSource(url);
    if (status === 404) {
      return false;
    }
    if (status === 200 || status === 406) {
      return true;
    }
    throw new Error(`Error checking if file exists at ${url}: ${status}`);
  }
}
