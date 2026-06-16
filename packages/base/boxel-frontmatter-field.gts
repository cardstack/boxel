import {
  Component,
  FieldDef,
  field,
  contains,
  type BaseDefComponent,
} from './card-api';
import StringField from './string';

// Base type for the value of `MarkdownDef.boxel` — the `boxel:` namespace of a
// markdown file's YAML frontmatter. Boxel-specific frontmatter is namespaced
// under `boxel:` so generic top-level keys (notably `name`/`description`, which
// are shared with Claude Code's SKILL.md) never trigger Boxel behavior. When the
// namespace declares a recognized `kind` (e.g. `kind: skill`), the concrete
// instance is a subclass (e.g. `SkillField`) selected by the kind registry.
export class BoxelFrontmatterField extends FieldDef {
  static displayName = 'Boxel Frontmatter';

  @field kind = contains(StringField);

  static embedded: BaseDefComponent = class Embedded extends Component<
    typeof this
  > {
    <template>
      {{@model.kind}}
    </template>
  };
}
