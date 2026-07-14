import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  computeStaleIds,
  loadManifest,
  parseFrontmatter,
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

  it('accepts the pre-copy-model shape without a commands list', () => {
    withManifestFile(
      JSON.stringify({ version: 'v0.0.22', skills: ['boxel-development'] }),
      (path) => {
        const m = loadManifest(path);
        expect(m).toEqual({
          version: 'v0.0.22',
          skills: ['boxel-development'],
        });
        expect(m?.commands).toBeUndefined();
      },
    );
  });

  it('accepts the copy-model shape with a commands list', () => {
    withManifestFile(
      JSON.stringify({
        version: 'v0.0.28',
        skills: ['boxel'],
        commands: ['boxel-create-card.md'],
      }),
      (path) => {
        expect(loadManifest(path)?.commands).toEqual(['boxel-create-card.md']);
      },
    );
  });

  it('rejects a malformed commands list', () => {
    withManifestFile(
      JSON.stringify({ version: 'v0.0.28', skills: [], commands: [42] }),
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

  it('returns {} for content without frontmatter', () => {
    expect(parseFrontmatter('# Just a heading\n')).toEqual({});
    expect(parseFrontmatter('---\nunterminated')).toEqual({});
  });
});
