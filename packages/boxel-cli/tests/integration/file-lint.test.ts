import '../helpers/setup-realm-server.ts';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ProfileManager } from '../../src/lib/profile-manager.ts';
import {
  startTestRealmServer,
  stopTestRealmServer,
  createTestHome,
  reloadProfile,
  setupTestProfile,
  createTestRealmViaCli,
} from '../helpers/integration.ts';
import { runBoxel } from '../helpers/run-boxel.ts';

// `boxel file lint <path> --realm <url>` sources code either from a local
// `--file` or by fetching <path> from the realm, POSTs it to the realm's
// `_lint` endpoint, and (with --json) prints `{ ok, fixed, output, messages }`
// on stdout. With --fix it writes the auto-fixed output back to the source.
// We drive the installed binary and verify realm state in-process.

interface LintJson {
  ok: boolean;
  error?: string;
  fixed?: boolean;
  output?: string;
  messages?: {
    ruleId: string | null;
    severity: 1 | 2;
    message: string;
    line: number;
    column: number;
  }[];
}

let home: string;
let cleanupProfile: () => void;
let realmUrl: string;
let verifyPm: ProfileManager;

/**
 * Lint `source` (staged in a throwaway local file) with `--json`, returning
 * the parsed lint result. `--file` is how the CLI accepts arbitrary source
 * that doesn't already live in the realm.
 */
async function lintSource(source: string, filename: string): Promise<LintJson> {
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-lint-'));
  let file = path.join(dir, filename);
  fs.writeFileSync(file, source, 'utf-8');
  try {
    let res = await runBoxel(
      ['file', 'lint', filename, '--realm', realmUrl, '--file', file, '--json'],
      { home },
    );
    return res.json<LintJson>();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

beforeAll(async () => {
  await startTestRealmServer();

  let testHome = createTestHome();
  home = testHome.home;
  cleanupProfile = testHome.cleanup;
  await setupTestProfile(testHome.profileManager);
  verifyPm = reloadProfile(home);

  ({ realmUrl } = await createTestRealmViaCli(home));
});

afterAll(async () => {
  cleanupProfile?.();
  await stopTestRealmServer();
});

describe('file lint (integration)', () => {
  it('lints source via the realm _lint endpoint and returns a result', async () => {
    let source = 'export const x = 1;\n';
    let result = await lintSource(source, 'test.gts');

    expect(result.ok).toBe(true);
    expect(result).toHaveProperty('messages');
    expect(Array.isArray(result.messages)).toBe(true);
    expect(result).toHaveProperty('output');
  });

  it('returns fixed output for source with formatting issues', async () => {
    let source = `import{CardDef}from '@cardstack/base/card-api';
export class MyCard extends CardDef {
@field name = contains(StringField);
}
`;
    let result = await lintSource(source, 'test.gts');

    expect(result.ok).toBe(true);
    expect(result.fixed).toBe(true);
    expect(result.output).toBeDefined();
    // ESLint should add the missing StringField import
    expect(result.output).toContain('import StringField from');
    // Prettier should fix indentation
    expect(result.output).toContain('  @field name = contains(StringField);');
  });

  it('returns fixed output with proper single-quote formatting', async () => {
    let source = `import { CardDef } from "@cardstack/base/card-api";
export class MyCard extends CardDef {
@field name = contains(StringField);
}
`;
    let result = await lintSource(source, 'test.gts');

    expect(result.ok).toBe(true);
    expect(result.fixed).toBe(true);
    expect(result.output).toBeDefined();
    // Prettier should convert double quotes to single quotes
    expect(result.output).toContain("'@cardstack/base/card-api'");
  });

  it('reports lint messages for unfixable issues', async () => {
    let source = `import { CardDef } from '@cardstack/base/card-api';
export class MyCard extends CardDef {
}
<template>
  <div class="my-card">Hello</div>
  <style scoped>
    .my-card {
      position: fixed;
      top: 0;
    }
  </style>
</template>
`;
    let result = await lintSource(source, 'test.gts');

    expect(result.ok).toBe(true);
    expect(result.messages).toBeDefined();
    let positionFixedWarning = result.messages!.find(
      (m) => m.ruleId === '@cardstack/boxel/no-css-position-fixed',
    );
    expect(positionFixedWarning).toBeDefined();
    expect(positionFixedWarning!.severity).toBe(1);
  });

  describe('--fix with --file (local file)', () => {
    it('writes fixed output back to a local file', async () => {
      let unfixedSource = `import{CardDef}from '@cardstack/base/card-api';
export class MyCard extends CardDef {
@field name = contains(StringField);
}
`;
      let tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-fix-'));
      let tmpFile = path.join(tmpDir, 'test-card.gts');
      fs.writeFileSync(tmpFile, unfixedSource, 'utf-8');

      try {
        // --fix rewrites the local file in place with the auto-fixed output.
        let res = await runBoxel(
          [
            'file',
            'lint',
            'test-card.gts',
            '--realm',
            realmUrl,
            '--file',
            tmpFile,
            '--fix',
          ],
          { home },
        );
        expect(res.ok, res.stderr).toBe(true);

        let fixedContent = fs.readFileSync(tmpFile, 'utf-8');
        expect(fixedContent).toContain('import StringField from');
        expect(fixedContent).toContain(
          '  @field name = contains(StringField);',
        );

        // Lint the fixed content again — should have no more fixable changes.
        let secondPass = await runBoxel(
          [
            'file',
            'lint',
            'test-card.gts',
            '--realm',
            realmUrl,
            '--file',
            tmpFile,
            '--json',
          ],
          { home },
        );
        expect(secondPass.ok, secondPass.stderr).toBe(true);
        expect(secondPass.json<LintJson>().fixed).toBe(false);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe('--fix without --file (realm file)', () => {
    it('writes fixed output back to the realm', async () => {
      let unfixedSource = `import{CardDef}from '@cardstack/base/card-api';
export class MyCard extends CardDef {
@field name = contains(StringField);
}
`;
      let filePath = 'fix-test-card.gts';

      // Upload unfixed source to the realm (setup stays in-process).
      let uploadUrl = new URL(filePath, realmUrl).href;
      let upload = await verifyPm.authedRealmFetch(uploadUrl, {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.card+source',
          'Content-Type': 'application/vnd.card+source',
        },
        body: unfixedSource,
      });
      expect(upload.ok, `upload failed: ${upload.status}`).toBe(true);

      // --fix without --file reads the file from the realm, lints it, and
      // writes the auto-fixed output back to the realm.
      let res = await runBoxel(
        ['file', 'lint', filePath, '--realm', realmUrl, '--fix'],
        { home },
      );
      expect(res.ok, res.stderr).toBe(true);

      // Read the file back from the realm and verify it's fixed.
      let response = await verifyPm.authedRealmFetch(uploadUrl, {
        method: 'GET',
        headers: { Accept: 'application/vnd.card+source' },
      });
      expect(response.ok).toBe(true);
      let fixedContent = await response.text();
      expect(fixedContent).toContain('import StringField from');
      expect(fixedContent).toContain('  @field name = contains(StringField);');
    });
  });

  it('returns error result when no active profile', async () => {
    let emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-empty-'));
    let srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-lint-src-'));
    let srcFile = path.join(srcDir, 'test.gts');
    fs.writeFileSync(srcFile, 'let x = 1;', 'utf-8');

    try {
      let res = await runBoxel(
        [
          'file',
          'lint',
          'test.gts',
          '--realm',
          realmUrl,
          '--file',
          srcFile,
          '--json',
        ],
        { home: emptyHome },
      );
      expect(res.exitCode).toBe(1);
      expect(res.stderr).toContain('No active profile');
    } finally {
      fs.rmSync(emptyHome, { recursive: true, force: true });
      fs.rmSync(srcDir, { recursive: true, force: true });
    }
  });
});
