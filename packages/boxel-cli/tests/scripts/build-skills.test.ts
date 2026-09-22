import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  computeStaleIds,
  loadManifest,
  parseFrontmatter,
  renderCatalogBlock,
} from '../../scripts/build-skills.ts';

describe('computeStaleIds', () => {
  it('returns [] when there is no prior list', () => {
    expect(computeStaleIds(null, ['a', 'b'])).toEqual([]);
    expect(computeStaleIds(undefined, ['a', 'b'])).toEqual([]);
  });

  it('returns prior entries that are no longer in the copy plan', () => {
    expect(
      computeStaleIds(
        ['boxel-development', 'dev-bfm-syntax', 'boxel-design'],
        ['boxel', 'boxel-design', 'glossary.md'],
      ),
    ).toEqual(['boxel-development', 'dev-bfm-syntax']);
  });

  it('returns [] when the new plan is a superset', () => {
    expect(computeStaleIds(['a', 'b'], ['a', 'b', 'c'])).toEqual([]);
  });

  it('sorts the stale list deterministically', () => {
    expect(computeStaleIds(['zebra', 'alpha', 'mango'], [])).toEqual([
      'alpha',
      'mango',
      'zebra',
    ]);
  });
});

describe('loadManifest', () => {
  function withManifestFile(content: string, fn: (path: string) => void): void {
    const dir = mkdtempSync(join(tmpdir(), 'build-skills-test-'));
    const path = join(dir, 'manifest.json');
    try {
      writeFileSync(path, content);
      fn(path);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('accepts a well-formed manifest', () => {
    withManifestFile(
      JSON.stringify({ version: 'v0.1.0', skills: ['boxel'] }),
      (path) => {
        expect(loadManifest(path)).toEqual({
          version: 'v0.1.0',
          skills: ['boxel'],
        });
      },
    );
  });

  it('ignores a leftover commands list from an older manifest', () => {
    withManifestFile(
      JSON.stringify({
        version: 'v0.0.30',
        skills: ['boxel'],
        commands: ['boxel-create-card.md'],
      }),
      (path) => {
        expect(loadManifest(path)?.skills).toEqual(['boxel']);
      },
    );
  });

  it('rejects a malformed skills list', () => {
    withManifestFile(
      JSON.stringify({ version: 'v0.1.0', skills: [42] }),
      (path) => {
        expect(loadManifest(path)).toBeNull();
      },
    );
  });

  it('rejects malformed JSON and missing files', () => {
    withManifestFile('not json', (path) => {
      expect(loadManifest(path)).toBeNull();
    });
    expect(loadManifest('/nonexistent/manifest.json')).toBeNull();
  });
});

describe('parseFrontmatter', () => {
  it('extracts single-line name and description', () => {
    const fm = parseFrontmatter(
      '---\nname: boxel\ndescription: Use whenever creating Boxel cards.\nboxel:\n  kind: skill\n---\n\n# Boxel\n',
    );
    expect(fm.name).toBe('boxel');
    expect(fm.description).toBe('Use whenever creating Boxel cards.');
  });

  it('strips matched surrounding quotes', () => {
    const fm = parseFrontmatter(
      '---\nname: \'quoted-name\'\ndescription: "A quoted description."\n---\n',
    );
    expect(fm.name).toBe('quoted-name');
    expect(fm.description).toBe('A quoted description.');
  });

  it('ignores indented keys inside nested blocks', () => {
    const fm = parseFrontmatter(
      '---\nname: outer\nboxel:\n  kind: skill\n  tools:\n    - name: inner\n---\n',
    );
    expect(fm.name).toBe('outer');
  });

  it('keeps the first occurrence when a key repeats', () => {
    const fm = parseFrontmatter('---\nname: first\nname: second\n---\n');
    expect(fm.name).toBe('first');
  });

  // A description longer than a line is naturally authored as a YAML block
  // scalar, and reading only the key's own line renders the README row as the
  // literal `>-`.
  it('reads a folded block scalar as its joined text', () => {
    const fm = parseFrontmatter(
      '---\nname: catalog-reuse\ndescription: >-\n  MANDATORY before writing any `.gts`.\n  Search the catalog first.\nboxel:\n  kind: skill\n---\n',
    );
    expect(fm.name).toBe('catalog-reuse');
    expect(fm.description).toBe(
      'MANDATORY before writing any `.gts`. Search the catalog first.',
    );
  });

  it('reads a literal block scalar with its line breaks kept', () => {
    const fm = parseFrontmatter(
      '---\nname: lit\ndescription: |\n  first line\n  second line\n---\n',
    );
    expect(fm.description).toBe('first line\nsecond line');
  });

  it('does not read a nested key as a block scalar continuation', () => {
    const fm = parseFrontmatter(
      '---\ndescription: >-\n  the text\nname: after\n---\n',
    );
    expect(fm.description).toBe('the text');
    expect(fm.name).toBe('after');
  });

  // YAML lets a block scalar carry an explicit indentation and/or chomping
  // indicator (`>2`, `|-`, `>2-`); the reader must treat those as the block
  // form too, not as a plain value beginning with `>`.
  it('reads a block scalar with explicit indentation/chomping indicators', () => {
    const fm = parseFrontmatter(
      '---\nname: indicators\ndescription: >2-\n  wrapped text\n  onto two lines.\n---\n',
    );
    expect(fm.description).toBe('wrapped text onto two lines.');
  });

  it('returns {} for content without frontmatter', () => {
    expect(parseFrontmatter('# Just a heading\n')).toEqual({});
    expect(parseFrontmatter('---\nunterminated')).toEqual({});
  });
});

describe('renderCatalogBlock', () => {
  function withSource(
    fn: (sourceRoot: string) => void,
    layout: {
      skills?: Record<string, string | null>;
    },
  ): void {
    const sourceRoot = mkdtempSync(join(tmpdir(), 'build-skills-src-'));
    try {
      const skillsDir = join(sourceRoot, 'skills');
      mkdirSync(skillsDir, { recursive: true });
      for (const [name, content] of Object.entries(layout.skills ?? {})) {
        if (content === null) {
          // A plain top-level file (e.g. glossary.md), not a skill directory.
          writeFileSync(join(skillsDir, name), '# glossary\n');
        } else {
          mkdirSync(join(skillsDir, name), { recursive: true });
          writeFileSync(join(skillsDir, name, 'SKILL.md'), content);
        }
      }
      fn(sourceRoot);
    } finally {
      rmSync(sourceRoot, { recursive: true, force: true });
    }
  }

  it('prefixes skills by directory name with /boxel-cli:', () => {
    withSource(
      (sourceRoot) => {
        const block = renderCatalogBlock(sourceRoot, ['boxel', 'glossary.md']);
        expect(block).toContain('| `/boxel-cli:boxel` | Authoring cards. |');
        // The plain top-level file has no SKILL.md and is skipped.
        expect(block).not.toContain('glossary');
        // No bare, un-namespaced skill rows leak through.
        expect(block).not.toMatch(/^\| `boxel` \|/m);
      },
      {
        skills: {
          boxel: '---\nname: boxel\ndescription: Authoring cards.\n---\n# B\n',
          'glossary.md': null,
        },
      },
    );
  });

  it('escapes pipe characters in descriptions and defaults a missing description to empty', () => {
    withSource(
      (sourceRoot) => {
        const block = renderCatalogBlock(sourceRoot, ['piped', 'nodesc']);
        expect(block).toContain('a \\| b');
        expect(block).toContain('| `/boxel-cli:nodesc` |  |');
      },
      {
        skills: {
          piped: '---\nname: piped\ndescription: a | b\n---\n',
          nodesc: '---\nname: nodesc\n---\n',
        },
      },
    );
  });
});
