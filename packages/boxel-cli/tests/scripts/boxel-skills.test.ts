import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import {
  CLAUDE_MARKETPLACE_PATH,
  CODEX_MARKETPLACE_PATH,
  boxelSkillsPin,
  boxelSkillsRoot,
  ensureBoxelSkills,
  readBoxelSkillsRef,
} from '../../scripts/boxel-skills.mts';

const PLUGIN_MANIFEST_PATH = resolve(
  import.meta.dirname,
  '../../plugin/.claude-plugin/plugin.json',
);

function withMarketplace(content: unknown, fn: (path: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'boxel-skills-test-'));
  const path = join(dir, 'marketplace.json');
  try {
    writeFileSync(path, JSON.stringify(content));
    fn(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('readBoxelSkillsRef', () => {
  it('reads the ref of the boxel-skills entry', () => {
    withMarketplace(
      {
        plugins: [
          { name: 'boxel-cli', source: './packages/boxel-cli/plugin' },
          {
            name: 'boxel-skills',
            source: {
              source: 'github',
              repo: 'cardstack/boxel-skills',
              ref: 'v1.2.3',
            },
          },
        ],
      },
      (path) => expect(readBoxelSkillsRef(path)).toBe('v1.2.3'),
    );
  });

  it('refuses a marketplace without a boxel-skills entry', () => {
    withMarketplace(
      { plugins: [{ name: 'boxel-cli', source: './x' }] },
      (path) => expect(() => readBoxelSkillsRef(path)).toThrow(/boxel-skills/),
    );
  });

  it('refuses a boxel-skills entry without a pinned ref', () => {
    withMarketplace(
      {
        plugins: [
          {
            name: 'boxel-skills',
            source: { source: 'github', repo: 'cardstack/boxel-skills' },
          },
        ],
      },
      (path) => expect(() => readBoxelSkillsRef(path)).toThrow(/ref/),
    );
  });
});

describe('the repo marketplaces', () => {
  it('pin Claude Code and Codex to the same boxel-skills release', () => {
    expect(readBoxelSkillsRef(CODEX_MARKETPLACE_PATH)).toBe(
      readBoxelSkillsRef(CLAUDE_MARKETPLACE_PATH),
    );
  });

  // Codex keys its plugin cache on the manifest version, so a release whose
  // Codex manifest version differs from its tag reaches Codex users as the
  // copy they already have, and a release without the manifest is not a
  // Codex plugin at all. This is the gate that refuses such a pin.
  it('pin a boxel-skills release whose Codex manifest version is its tag', () => {
    ensureBoxelSkills();
    const manifest = JSON.parse(
      readFileSync(
        join(boxelSkillsRoot(), '.codex-plugin', 'plugin.json'),
        'utf8',
      ),
    );
    expect(`v${manifest.version}`).toBe(boxelSkillsPin());
  }, 120_000);

  it('list every plugin the boxel-cli plugin depends on', () => {
    const manifest = JSON.parse(readFileSync(PLUGIN_MANIFEST_PATH, 'utf8'));
    const marketplace = JSON.parse(
      readFileSync(CLAUDE_MARKETPLACE_PATH, 'utf8'),
    );
    const listed = new Set(
      marketplace.plugins.map((plugin: { name: string }) => plugin.name),
    );
    expect(manifest.dependencies).toContain('boxel-skills');
    for (const dependency of manifest.dependencies) {
      expect(listed).toContain(dependency);
    }
  });
});
