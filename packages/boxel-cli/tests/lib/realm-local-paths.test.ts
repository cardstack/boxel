import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  absoluteStructuredPathForRealmUrl,
  findMisplacedLocalRealmDirs,
  relativeStructuredPathForRealmUrl,
  resetWarnedFlagForTests,
  warnIfMisplacedLocalRealmDirs,
} from '../../src/lib/realm-local-paths.js';
import { setQuiet } from '../../src/lib/cli-log.js';

function writeManifest(dir: string, body: unknown): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.boxel-sync.json'),
    typeof body === 'string' ? body : JSON.stringify(body),
  );
}

describe('relativeStructuredPathForRealmUrl', () => {
  it('maps a canonical stack.cards URL to <domain>/<owner>/<realm>', () => {
    expect(
      relativeStructuredPathForRealmUrl('https://stack.cards/alice/notes'),
    ).toBe(path.join('stack.cards', 'alice', 'notes'));
  });

  it('folds *.stack.cards subdomains to stack.cards', () => {
    expect(
      relativeStructuredPathForRealmUrl(
        'https://staging.stack.cards/alice/notes',
      ),
    ).toBe(path.join('stack.cards', 'alice', 'notes'));
  });

  it('folds *.boxel.ai subdomains to boxel.ai', () => {
    expect(
      relativeStructuredPathForRealmUrl('https://foo.boxel.ai/bob/realm'),
    ).toBe(path.join('boxel.ai', 'bob', 'realm'));
  });

  it('passes other hostnames through unchanged', () => {
    expect(
      relativeStructuredPathForRealmUrl('https://custom.example.org/u/r'),
    ).toBe(path.join('custom.example.org', 'u', 'r'));
  });

  it('ignores trailing slashes in the URL path', () => {
    expect(
      relativeStructuredPathForRealmUrl('https://stack.cards/alice/notes/'),
    ).toBe(path.join('stack.cards', 'alice', 'notes'));
  });

  it('uses defaults when the URL has only one path segment', () => {
    expect(relativeStructuredPathForRealmUrl('https://stack.cards/only')).toBe(
      path.join('stack.cards', 'only', 'only'),
    );
  });

  it('uses defaults when the URL has an empty path', () => {
    expect(relativeStructuredPathForRealmUrl('https://stack.cards')).toBe(
      path.join('stack.cards', 'unknown-owner', 'workspace'),
    );
  });

  it('returns null for a string that is not a parseable URL', () => {
    expect(relativeStructuredPathForRealmUrl('not a url')).toBeNull();
    expect(relativeStructuredPathForRealmUrl('')).toBeNull();
  });

  it('returns null for segments containing encoded path separators or NUL', () => {
    // `%2F` decodes to `/`, `%5C` to `\`, `%00` to NUL — any of these in an
    // owner/realm segment could be used to construct a destination outside
    // the intended <domain>/<owner>/<realm> tree if we let them through.
    expect(
      relativeStructuredPathForRealmUrl('https://stack.cards/foo%2Fbar/baz'),
    ).toBeNull();
    expect(
      relativeStructuredPathForRealmUrl('https://stack.cards/alice/foo%5Cbar'),
    ).toBeNull();
    expect(
      relativeStructuredPathForRealmUrl('https://stack.cards/foo%00bar/baz'),
    ).toBeNull();
  });

  it('produces a safely-rooted path even for traversal-shaped URLs (WHATWG normalizes ..)', () => {
    // The URL parser collapses `..` to `/`; the result lives under
    // `<root>/stack.cards/...` and never escapes.
    expect(relativeStructuredPathForRealmUrl('https://stack.cards/../..')).toBe(
      path.join('stack.cards', 'unknown-owner', 'workspace'),
    );
    expect(
      relativeStructuredPathForRealmUrl('https://stack.cards/%2e%2e/foo'),
    ).toBe(path.join('stack.cards', 'foo', 'foo'));
  });
});

describe('absoluteStructuredPathForRealmUrl', () => {
  it('resolves the structured path against the supplied root', () => {
    expect(
      absoluteStructuredPathForRealmUrl(
        'https://stack.cards/alice/notes',
        '/tmp/root',
      ),
    ).toBe(path.resolve('/tmp/root', 'stack.cards', 'alice', 'notes'));
  });

  it('returns null for an unparseable realmUrl', () => {
    expect(
      absoluteStructuredPathForRealmUrl('not a url', '/tmp/root'),
    ).toBeNull();
  });
});

describe('findMisplacedLocalRealmDirs', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-rlp-find-'));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('returns [] for an empty root', () => {
    expect(findMisplacedLocalRealmDirs(tmpRoot)).toEqual([]);
  });

  it('returns [] when the root does not exist', () => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    expect(findMisplacedLocalRealmDirs(tmpRoot)).toEqual([]);
  });

  it('finds a legacy-layout directory and computes the canonical expectedDir', () => {
    const legacyDir = path.join(tmpRoot, 'old-notes');
    writeManifest(legacyDir, { realmUrl: 'https://stack.cards/alice/notes' });

    const entries = findMisplacedLocalRealmDirs(tmpRoot);
    expect(entries).toHaveLength(1);
    expect(entries[0].currentDir).toBe(legacyDir);
    expect(entries[0].expectedDir).toBe(
      path.join(tmpRoot, 'stack.cards', 'alice', 'notes'),
    );
    expect(entries[0].realmUrl).toBe('https://stack.cards/alice/notes');
  });

  it('returns [] when a directory is already in the canonical layout at the right path', () => {
    const canonicalDir = path.join(tmpRoot, 'stack.cards', 'alice', 'notes');
    writeManifest(canonicalDir, {
      realmUrl: 'https://stack.cards/alice/notes',
    });

    expect(findMisplacedLocalRealmDirs(tmpRoot)).toEqual([]);
  });

  it('returns only the misplaced entries when the tree mixes correct and incorrect dirs', () => {
    writeManifest(path.join(tmpRoot, 'stack.cards', 'alice', 'good'), {
      realmUrl: 'https://stack.cards/alice/good',
    });
    writeManifest(path.join(tmpRoot, 'misplaced'), {
      realmUrl: 'https://stack.cards/alice/notes',
    });

    const entries = findMisplacedLocalRealmDirs(tmpRoot);
    expect(entries.map((e) => e.currentDir)).toEqual([
      path.join(tmpRoot, 'misplaced'),
    ]);
  });

  it('does not descend into skippable directories like .git or node_modules', () => {
    writeManifest(path.join(tmpRoot, '.git'), {
      realmUrl: 'https://stack.cards/alice/notes',
    });
    writeManifest(path.join(tmpRoot, 'node_modules'), {
      realmUrl: 'https://stack.cards/alice/notes',
    });

    expect(findMisplacedLocalRealmDirs(tmpRoot)).toEqual([]);
  });

  it('ignores manifests that lack realmUrl', () => {
    writeManifest(path.join(tmpRoot, 'bad-no-url'), { files: {} });
    writeManifest(path.join(tmpRoot, 'bad-empty-url'), { realmUrl: '' });

    expect(findMisplacedLocalRealmDirs(tmpRoot)).toEqual([]);
  });

  it('ignores unparseable manifest JSON without throwing', () => {
    writeManifest(path.join(tmpRoot, 'malformed'), '{not json');

    expect(() => findMisplacedLocalRealmDirs(tmpRoot)).not.toThrow();
    expect(findMisplacedLocalRealmDirs(tmpRoot)).toEqual([]);
  });

  it('ignores manifests whose realmUrl is not a parseable URL (no throw)', () => {
    writeManifest(path.join(tmpRoot, 'bad-url'), {
      realmUrl: 'not even a url',
    });

    expect(() => findMisplacedLocalRealmDirs(tmpRoot)).not.toThrow();
    expect(findMisplacedLocalRealmDirs(tmpRoot)).toEqual([]);
  });

  it('ignores manifests with encoded path separators in segments', () => {
    writeManifest(path.join(tmpRoot, 'sneaky-slash'), {
      realmUrl: 'https://stack.cards/foo%2Fbar/baz',
    });

    expect(findMisplacedLocalRealmDirs(tmpRoot)).toEqual([]);
  });

  it('keeps traversal-shaped URLs inside rootDir (WHATWG normalizes ..)', () => {
    writeManifest(path.join(tmpRoot, 'traversal-attempt'), {
      realmUrl: 'https://stack.cards/../../etc/passwd',
    });

    const entries = findMisplacedLocalRealmDirs(tmpRoot);
    expect(entries).toHaveLength(1);
    // expectedDir must stay strictly within tmpRoot, never escape.
    expect(entries[0].expectedDir.startsWith(path.resolve(tmpRoot))).toBe(true);
    expect(
      path
        .relative(path.resolve(tmpRoot), entries[0].expectedDir)
        .startsWith('..'),
    ).toBe(false);
  });
});

describe('warnIfMisplacedLocalRealmDirs', () => {
  let tmpRoot: string;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  const ORIGINAL_DISABLE = process.env.BOXEL_DISABLE_PATH_WARNING;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-rlp-warn-'));
    resetWarnedFlagForTests();
    setQuiet(false);
    delete process.env.BOXEL_DISABLE_PATH_WARNING;
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    setQuiet(false);
    resetWarnedFlagForTests();
    if (ORIGINAL_DISABLE === undefined) {
      delete process.env.BOXEL_DISABLE_PATH_WARNING;
    } else {
      process.env.BOXEL_DISABLE_PATH_WARNING = ORIGINAL_DISABLE;
    }
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('does not warn when no misplaced dirs are present', () => {
    warnIfMisplacedLocalRealmDirs(tmpRoot);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('fires console.warn once even when called repeatedly', () => {
    writeManifest(path.join(tmpRoot, 'misplaced'), {
      realmUrl: 'https://stack.cards/alice/notes',
    });

    warnIfMisplacedLocalRealmDirs(tmpRoot);
    warnIfMisplacedLocalRealmDirs(tmpRoot);

    const callsWithLegacyHeader = warnSpy.mock.calls.filter((args) =>
      String(args[0] ?? '').includes('legacy local paths'),
    );
    expect(callsWithLegacyHeader).toHaveLength(1);
  });

  it('does nothing when BOXEL_DISABLE_PATH_WARNING=1 is set', () => {
    writeManifest(path.join(tmpRoot, 'misplaced'), {
      realmUrl: 'https://stack.cards/alice/notes',
    });
    process.env.BOXEL_DISABLE_PATH_WARNING = '1';

    warnIfMisplacedLocalRealmDirs(tmpRoot);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('does nothing when isQuiet() is true', () => {
    writeManifest(path.join(tmpRoot, 'misplaced'), {
      realmUrl: 'https://stack.cards/alice/notes',
    });
    setQuiet(true);

    warnIfMisplacedLocalRealmDirs(tmpRoot);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('does not throw when a manifest contains a malformed realmUrl (regression for preAction crash)', () => {
    writeManifest(path.join(tmpRoot, 'broken'), {
      realmUrl: 'not even a url',
    });

    expect(() => warnIfMisplacedLocalRealmDirs(tmpRoot)).not.toThrow();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
