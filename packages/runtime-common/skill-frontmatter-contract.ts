/**
 * The description-parsing contract for `readFrontmatterDescription` in
 * `packages/software-factory/src/skill-catalog.ts`, the hand-rolled skill
 * frontmatter reader that fills what `list_skills` advertises to the agent:
 * which block-scalar indicators it reads, how it joins folded and literal
 * blocks, and which quotes it strips. A second reader of skill frontmatter
 * should iterate the same cases, so two readers cannot advertise different
 * descriptions for one skill.
 *
 * Dependency-free on purpose, so any package can import it as a
 * `@cardstack/runtime-common/<subpath>` module.
 */
export interface SkillFrontmatterCase {
  /** Case name; also used as the on-disk skill directory name in tests. */
  label: string;
  /** The frontmatter body between the `---` fences (fences excluded). */
  frontmatter: string;
  /** The description a reader must extract from that frontmatter. */
  description: string;
}

export const SKILL_FRONTMATTER_DESCRIPTION_CASES: readonly SkillFrontmatterCase[] =
  [
    {
      label: 'plain',
      frontmatter: 'name: plain\ndescription: Just one line.',
      description: 'Just one line.',
    },
    {
      label: 'quoted',
      frontmatter: 'name: quoted\ndescription: "A quoted line."',
      description: 'A quoted line.',
    },
    {
      label: 'folded',
      frontmatter:
        'name: folded\ndescription: >-\n  MANDATORY before writing any `.gts`.\n  Search the catalog first.\nboxel:\n  kind: skill',
      description:
        'MANDATORY before writing any `.gts`. Search the catalog first.',
    },
    {
      label: 'literal',
      frontmatter: 'name: literal\ndescription: |\n  first line\n  second line',
      description: 'first line\nsecond line',
    },
    {
      label: 'explicit-indicators',
      frontmatter:
        'name: explicit-indicators\ndescription: >2-\n  wrapped text\n  onto two lines.',
      description: 'wrapped text onto two lines.',
    },
    {
      label: 'key-after-block-scalar',
      frontmatter:
        'name: key-after-block-scalar\ndescription: >-\n  the text\nboxel:\n  kind: skill',
      description: 'the text',
    },
  ];
