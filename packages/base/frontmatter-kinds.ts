import { FrontmatterField } from './frontmatter-field';
import { SkillField } from './skill-field';

// Maps a frontmatter `kind` to the FieldDef that models it. This registry lives
// above `MarkdownDef` so the base markdown type stays ignorant of its kinds:
// adding a new kind (e.g. `recipe`, `persona`) is a new field type + an entry
// here, not a new FileDef subclass or extension rule.
const FRONTMATTER_FIELD_BY_KIND: Record<string, typeof FrontmatterField> = {
  skill: SkillField,
};

export function frontmatterFieldForKind(
  kind: string | undefined,
): typeof FrontmatterField {
  if (kind && Object.prototype.hasOwnProperty.call(FRONTMATTER_FIELD_BY_KIND, kind)) {
    return FRONTMATTER_FIELD_BY_KIND[kind];
  }
  return FrontmatterField;
}

export function isKnownFrontmatterKind(kind: string | undefined): boolean {
  return (
    !!kind && Object.prototype.hasOwnProperty.call(FRONTMATTER_FIELD_BY_KIND, kind)
  );
}
