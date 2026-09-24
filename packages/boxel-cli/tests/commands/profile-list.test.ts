import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { listProfiles } from '../../src/commands/profile.js';
import { ProfileManager } from '../../src/lib/profile-manager.js';
import type { MatrixAuth } from '../../src/lib/auth.js';

function fakeAuth(matrixId: string, matrixUrl: string): MatrixAuth {
  return {
    accessToken: `token-for-${matrixId}`,
    userId: matrixId,
    deviceId: `DEVICE_${matrixId.replace(/[^A-Za-z0-9]/g, '_')}`,
    matrixUrl,
  };
}

// Capture everything listProfiles writes to stdout, with ANSI color codes
// stripped so assertions read against the plain text a user sees.
function captureLog(): { lines: () => string; restore: () => void } {
  const chunks: string[] = [];
  const spy = vi
    .spyOn(console, 'log')
    .mockImplementation((...args: unknown[]) => {
      chunks.push(args.join(' '));
    });
  return {
    // eslint-disable-next-line no-control-regex
    lines: () => chunks.join('\n').replace(/\[[0-9;]*m/g, ''),
    restore: () => spy.mockRestore(),
  };
}

describe('profile list', () => {
  let tmpDir: string;
  let manager: ProfileManager;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-profile-list-'));
    manager = new ProfileManager(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // A store with many profiles must list every one — the bug this guards
  // against is a listing that silently omits, so a present profile reads as
  // absent.
  async function seedProfiles(count: number): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const id = `@user${i}:boxel.ai`;
      await manager.addProfileWithAuth(
        id,
        fakeAuth(id, 'https://matrix.boxel.ai'),
      );
      ids.push(id);
    }
    return ids;
  }

  it('lists every saved profile, however many there are', async () => {
    const ids = await seedProfiles(16);

    const out = captureLog();
    try {
      await listProfiles(manager);
    } finally {
      out.restore();
    }

    const text = out.lines();
    for (const id of ids) {
      expect(text).toContain(id);
    }
  });

  it('names the total count so the reader can see the listing is complete', async () => {
    await seedProfiles(16);

    const out = captureLog();
    try {
      await listProfiles(manager);
    } finally {
      out.restore();
    }

    expect(out.lines()).toContain('Saved Profiles (16 profiles)');
  });

  it('uses the singular for a single profile', async () => {
    await seedProfiles(1);

    const out = captureLog();
    try {
      await listProfiles(manager);
    } finally {
      out.restore();
    }

    expect(out.lines()).toContain('Saved Profiles (1 profile)');
  });

  it('reports no profiles configured when the store is empty', async () => {
    const out = captureLog();
    try {
      await listProfiles(manager);
    } finally {
      out.restore();
    }

    expect(out.lines()).toContain('No profiles configured.');
  });

  describe('--json', () => {
    it('emits the complete profile set as parseable JSON', async () => {
      const ids = await seedProfiles(16);
      manager.switchProfile(ids[3]);

      const out = captureLog();
      try {
        await listProfiles(manager, { json: true });
      } finally {
        out.restore();
      }

      const parsed = JSON.parse(out.lines());
      expect(parsed.activeProfile).toBe(ids[3]);
      expect(parsed.profiles).toHaveLength(16);
      expect(parsed.profiles.map((p: { id: string }) => p.id)).toEqual(ids);

      const active = parsed.profiles.find((p: { active: boolean }) => p.active);
      expect(active.id).toBe(ids[3]);
      expect(active).toMatchObject({
        displayName: expect.any(String),
        environment: 'production',
        domain: 'boxel.ai',
        matrixUrl: 'https://matrix.boxel.ai',
        realmServerUrl: 'https://app.boxel.ai/',
      });
    });

    it('emits an empty profile list rather than a human message', async () => {
      const out = captureLog();
      try {
        await listProfiles(manager, { json: true });
      } finally {
        out.restore();
      }

      const parsed = JSON.parse(out.lines());
      expect(parsed).toEqual({ activeProfile: null, profiles: [] });
    });

    it('carries no ANSI color codes', async () => {
      await seedProfiles(2);

      const chunks: string[] = [];
      const spy = vi
        .spyOn(console, 'log')
        .mockImplementation((...args: unknown[]) => {
          chunks.push(args.join(' '));
        });
      try {
        await listProfiles(manager, { json: true });
      } finally {
        spy.mockRestore();
      }

      // eslint-disable-next-line no-control-regex
      expect(chunks.join('\n')).not.toMatch(/\[/);
    });
  });

  // A store that exists but can't be read must not be presented as an empty
  // one: discovery reports the failure and exits non-zero, so a caller can tell
  // "couldn't read the store" from "no such profile".
  describe('unreadable store', () => {
    let savedExitCode: typeof process.exitCode;

    beforeEach(() => {
      savedExitCode = process.exitCode;
      process.exitCode = undefined;
      fs.writeFileSync(path.join(tmpDir, 'profiles.json'), 'not valid json{{{');
      // Re-load: the manager reads the store in its constructor, and the one
      // from the outer beforeEach was built before the corrupt file existed.
      manager = new ProfileManager(tmpDir);
    });

    afterEach(() => {
      process.exitCode = savedExitCode;
    });

    it('reports the error to stderr and exits non-zero (human view)', async () => {
      const errs: string[] = [];
      const spy = vi
        .spyOn(console, 'error')
        .mockImplementation((...args: unknown[]) => {
          errs.push(args.join(' '));
        });
      try {
        await listProfiles(manager);
      } finally {
        spy.mockRestore();
      }

      // The message text sits between color codes, so a substring match finds
      // it without stripping ANSI.
      expect(errs.join('\n')).toMatch(/Could not read profiles file/);
      expect(process.exitCode).toBe(1);
    });

    it('carries the error in the JSON and exits non-zero', async () => {
      const out = captureLog();
      try {
        await listProfiles(manager, { json: true });
      } finally {
        out.restore();
      }

      const parsed = JSON.parse(out.lines());
      expect(parsed.error).toMatch(/Could not read profiles file/);
      expect(parsed.profiles).toEqual([]);
      expect(process.exitCode).toBe(1);
    });
  });
});
