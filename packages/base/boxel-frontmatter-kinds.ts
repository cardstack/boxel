import { BoxelFrontmatterField } from './boxel-frontmatter-field';
import { SkillFrontmatterField } from './skill-frontmatter-field';

// Maps a `boxel.kind` value to the FieldDef that models it. This registry lives
// above `MarkdownDef` so the base markdown type stays ignorant of its kinds:
// adding a new kind (e.g. `recipe`, `persona`) is a new field type + an entry
// here, not a new FileDef subclass or extension rule.
const BOXEL_FIELD_BY_KIND: Record<string, typeof BoxelFrontmatterField> = {
  skill: SkillFrontmatterField,
};

export function boxelFieldForKind(
  kind: string | undefined,
): typeof BoxelFrontmatterField {
  if (kind && Object.prototype.hasOwnProperty.call(BOXEL_FIELD_BY_KIND, kind)) {
    return BOXEL_FIELD_BY_KIND[kind];
  }
  return BoxelFrontmatterField;
}

export function isKnownBoxelKind(kind: string | undefined): boolean {
  return (
    !!kind && Object.prototype.hasOwnProperty.call(BOXEL_FIELD_BY_KIND, kind)
  );
}
