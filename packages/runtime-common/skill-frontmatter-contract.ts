/**
 * The description-parsing contract shared by the two hand-rolled skill
 * frontmatter readers:
 *
 *   - `parseFrontmatter` in `packages/boxel-cli/scripts/build-skills.ts`,
 *     which fills the plugin README's catalog tables, and
 *   - `readFrontmatterDescription` in
 *     `packages/software-factory/src/skill-catalog.ts`, which fills what
 *     `list_skills` advertises to the agent.
 *
 * They are two implementations of one behaviour — same block-scalar
 * indicators, same fold/literal join, same quote stripping — kept in
 * agreement by hand. Each package's test iterates these cases, so a change to
 * one reader that is not mirrored in the other fails a test here rather than
 * silently advertising two different descriptions for the same skill.
 *
 * Dependency-free on purpose: both packages import it as a
 * `@cardstack/runtime-common/<subpath>` module, and boxel-cli's type-check is
 * deliberately dependency-light.
 */
export interface SkillFrontmatterCase {
  /** Case name; also used as the on-disk skill directory name in tests. */
  label: string;
  /** The frontmatter body between the `---` fences (fences excluded). */
  frontmatter: string;
  /** The description both readers must extract from that frontmatter. */
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
