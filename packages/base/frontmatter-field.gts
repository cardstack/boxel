import {
  Component,
  FieldDef,
  field,
  contains,
  type BaseDefComponent,
} from './card-api';
import { JsonField } from './json-field';

// The parsed YAML frontmatter of a markdown file, captured as JSON. The base
// type holds the entire frontmatter in `rawContent`; when the frontmatter
// declares a recognized `boxel.kind` (e.g. `skill`), the concrete instance is a
// subclass (e.g. `SkillFrontmatterField`) selected by the kind registry, which
// adds typed fields on top of the raw copy.
export class FrontmatterField extends FieldDef {
  static displayName = 'Frontmatter';

  // The entire frontmatter (all top-level keys), as JSON — a lossless raw copy.
  // Not indexed for search; searchable bits are projected into typed fields
  // (e.g. `MarkdownDef.kind`, `SkillFrontmatterField.name`).
  @field rawContent = contains(JsonField);

  static embedded: BaseDefComponent = class Embedded extends Component<
    typeof this
  > {
    get kind() {
      let raw = this.args.model?.rawContent as
        | { boxel?: { kind?: string } }
        | undefined;
      return raw?.boxel?.kind ?? '';
    }
    <template>
      {{this.kind}}
    </template>
  };
}
