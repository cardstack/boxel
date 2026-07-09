import {
  Component,
  field,
  contains,
  containsMany,
  type BaseDefComponent,
} from './card-api';
import StringField from './string';
import { FrontmatterField } from './frontmatter-field';
import { ToolField } from './tool-field';

// A skill markdown file's frontmatter (`boxel.kind: skill`). Adds typed fields
// on top of the base `FrontmatterField` (which holds the raw frontmatter in
// `rawContent`). Mirrors the field shape of the legacy `Skill` card so the
// host's tool-definition upload flow reads `markdownDef.frontmatter.tools`
// exactly as it reads `Skill.commands`. `name`/`description` are sourced from the
// shared top-level frontmatter keys (see `MarkdownDef.extractAttributes`).
export class SkillFrontmatterField extends FrontmatterField {
  static displayName = 'Skill';

  @field name = contains(StringField);
  @field description = contains(StringField);
  @field tools = containsMany(ToolField);
  // Legacy spelling of `tools`. Index rows extracted before the
  // command -> tool rename persist the value under a `commands` attribute;
  // this field lets those rows rehydrate without a reindex. Consumers read
  // `tools` and fall back to this (see the host's `getSkillSourceCommands`).
  // Remove once all realms have reindexed post-rename.
  @field commands = containsMany(ToolField);

  // `name`/`description` come from the shared top-level frontmatter keys;
  // `tools` from the `boxel:` namespace (`boxel.tools`, with the pre-rename
  // `boxel.commands` key still accepted; `tools` wins when both are present).
  // Only this subclass knows that mapping.
  static fromFrontmatter(
    frontmatter: Record<string, unknown>,
  ): Record<string, unknown> {
    let boxel =
      frontmatter.boxel &&
      typeof frontmatter.boxel === 'object' &&
      !Array.isArray(frontmatter.boxel)
        ? (frontmatter.boxel as Record<string, unknown>)
        : undefined;
    return {
      ...super.fromFrontmatter(frontmatter),
      name: frontmatter.name,
      description: frontmatter.description,
      tools: boxel?.tools ?? boxel?.commands,
    };
  }

  static embedded: BaseDefComponent = class Embedded extends Component<
    typeof this
  > {
    <template>
      {{@model.name}}
    </template>
  };
}
