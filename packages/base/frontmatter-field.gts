import {
  Component,
  FieldDef,
  field,
  contains,
  type BaseDefComponent,
} from './card-api';
import StringField from './string';

// Base type for the value of `MarkdownDef.frontmatter`. A markdown file's YAML
// frontmatter is parsed into a `FrontmatterField`; when the frontmatter
// declares a recognized `kind` (e.g. `kind: skill`), the concrete instance is a
// subclass (e.g. `SkillField`) selected by the kind registry. Plain markdown
// with no recognized kind stays a base `FrontmatterField`.
export class FrontmatterField extends FieldDef {
  static displayName = 'Frontmatter';

  @field kind = contains(StringField);

  static embedded: BaseDefComponent = class Embedded extends Component<
    typeof this
  > {
    <template>
      {{@model.kind}}
    </template>
  };
}
