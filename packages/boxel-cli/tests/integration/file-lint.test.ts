import '../helpers/setup-realm-server.ts';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { lint } from '../../src/commands/file/lint.ts';
import { write } from '../../src/commands/file/write.ts';
import { createRealm } from '../../src/commands/realm/create.ts';
import { ProfileManager } from '../../src/lib/profile-manager.ts';
import {
  startTestRealmServer,
  stopTestRealmServer,
  createTestProfileDir,
  setupTestProfile,
  uniqueRealmName,
} from '../helpers/integration.ts';

let profileManager: ProfileManager;
let cleanupProfile: () => void;
let realmUrl: string;

async function createTestRealm(): Promise<string> {
  let name = uniqueRealmName();
  await createRealm(name, `Test ${name}`, { profileManager });

  let realmTokens =
    profileManager.getActiveProfile()!.profile.realmTokens ?? {};
  let entry = Object.entries(realmTokens).find(([url]) => url.includes(name));
  if (!entry) {
    throw new Error(`No realm JWT stored for ${name}`);
  }
  return entry[0];
}

beforeAll(async () => {
  await startTestRealmServer();

  let testProfile = createTestProfileDir();
  profileManager = testProfile.profileManager;
  cleanupProfile = testProfile.cleanup;
  await setupTestProfile(profileManager);

  realmUrl = await createTestRealm();
});

afterAll(async () => {
  cleanupProfile?.();
  await stopTestRealmServer();
});

describe('file lint (integration)', () => {
  it('lints source via the realm _lint endpoint and returns a result', async () => {
    let source = 'export const x = 1;\n';
    let result = await lint(realmUrl, source, 'test.gts', { profileManager });

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
    let result = await lint(realmUrl, source, 'test.gts', { profileManager });

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
    let result = await lint(realmUrl, source, 'test.gts', { profileManager });

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
    let result = await lint(realmUrl, source, 'test.gts', { profileManager });

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
      let tmpFile = path.join(
        fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-fix-')),
        'test-card.gts',
      );
      fs.writeFileSync(tmpFile, unfixedSource, 'utf-8');

      try {
        let source = fs.readFileSync(tmpFile, 'utf-8');
        let result = await lint(realmUrl, source, 'test-card.gts', {
          profileManager,
        });

        expect(result.ok).toBe(true);
        expect(result.fixed).toBe(true);
        expect(result.output).toBeDefined();

        // Simulate what the CLI --fix does for local files
        fs.writeFileSync(tmpFile, result.output!, 'utf-8');

        let fixedContent = fs.readFileSync(tmpFile, 'utf-8');
        expect(fixedContent).toContain('import StringField from');
        expect(fixedContent).toContain(
          '  @field name = contains(StringField);',
        );

        // Lint the fixed content again — should have no more fixable changes
        let secondPass = await lint(realmUrl, fixedContent, 'test-card.gts', {
          profileManager,
        });
        expect(secondPass.ok).toBe(true);
        expect(secondPass.fixed).toBe(false);
      } finally {
        fs.rmSync(path.dirname(tmpFile), { recursive: true, force: true });
      }
    });
  });

  describe('--fix without --file (realm file)', () => {
    it('writes fixed output back to the realm via write()', async () => {
      let unfixedSource = `import{CardDef}from '@cardstack/base/card-api';
export class MyCard extends CardDef {
@field name = contains(StringField);
}
`;
      let filePath = 'fix-test-card.gts';

      // Upload unfixed source to the realm
      let uploadResult = await write(realmUrl, filePath, unfixedSource, {
        profileManager,
      });
      expect(uploadResult.ok).toBe(true);

      // Lint it
      let result = await lint(realmUrl, unfixedSource, filePath, {
        profileManager,
      });
      expect(result.ok).toBe(true);
      expect(result.fixed).toBe(true);
      expect(result.output).toBeDefined();

      // Simulate what the CLI --fix does for realm files
      let writeResult = await write(realmUrl, filePath, result.output!, {
        profileManager,
      });
      expect(writeResult.ok).toBe(true);

      // Read the file back from the realm and verify it's fixed
      let readUrl = new URL(filePath, realmUrl).href;
      let response = await profileManager.authedRealmFetch(readUrl, {
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
    let emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-empty-'));
    let emptyManager = new ProfileManager(emptyDir);

    try {
      let result = await lint(realmUrl, 'let x = 1;', 'test.gts', {
        profileManager: emptyManager,
      });
      expect(result.ok).toBe(false);
      expect(result.error).toContain('No active profile');
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});
