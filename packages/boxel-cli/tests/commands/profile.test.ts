import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  ProfileManager,
  getEnvironmentFromMatrixId,
  getUsernameFromMatrixId,
  getDomainFromMatrixId,
  getEnvironmentShortLabel,
} from '../../src/lib/profile-manager.js';

describe('ProfileManager', () => {
  let tmpDir: string;
  let manager: ProfileManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-profile-test-'));
    manager = new ProfileManager(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('starts with no profiles', () => {
    expect(manager.listProfiles()).toEqual([]);
    expect(manager.getActiveProfileId()).toBeNull();
    expect(manager.getActiveProfile()).toBeNull();
  });

  it('adds a profile and sets it as active when no other profiles exist', async () => {
    await manager.addProfile(
      '@testuser:stack.cards',
      'password123',
      'Test User',
    );

    expect(manager.listProfiles()).toEqual(['@testuser:stack.cards']);
    expect(manager.getActiveProfileId()).toBe('@testuser:stack.cards');

    const profile = manager.getProfile('@testuser:stack.cards');
    expect(profile).toBeDefined();
    expect(profile!.displayName).toBe('Test User');
    expect(profile!.password).toBe('password123');
    expect(profile!.matrixUrl).toBe('https://matrix-staging.stack.cards');
    expect(profile!.realmServerUrl).toBe('https://realms-staging.stack.cards/');
  });

  it('adds a production profile with correct defaults', async () => {
    await manager.addProfile('@testuser:boxel.ai', 'password123');

    const profile = manager.getProfile('@testuser:boxel.ai');
    expect(profile).toBeDefined();
    expect(profile!.matrixUrl).toBe('https://matrix.boxel.ai');
    expect(profile!.realmServerUrl).toBe('https://app.boxel.ai/');
    expect(profile!.displayName).toBe('testuser \u00b7 boxel.ai');
  });

  it('does not change active profile when adding a second profile', async () => {
    await manager.addProfile('@first:stack.cards', 'pass1');
    await manager.addProfile('@second:stack.cards', 'pass2');

    expect(manager.getActiveProfileId()).toBe('@first:stack.cards');
    expect(manager.listProfiles()).toHaveLength(2);
  });

  it('switches active profile', async () => {
    await manager.addProfile('@first:stack.cards', 'pass1');
    await manager.addProfile('@second:stack.cards', 'pass2');

    expect(manager.switchProfile('@second:stack.cards')).toBe(true);
    expect(manager.getActiveProfileId()).toBe('@second:stack.cards');
  });

  it('returns false when switching to nonexistent profile', () => {
    expect(manager.switchProfile('@nonexistent:stack.cards')).toBe(false);
  });

  it('removes a profile', async () => {
    await manager.addProfile('@testuser:stack.cards', 'password123');

    expect(await manager.removeProfile('@testuser:stack.cards')).toBe(true);
    expect(manager.listProfiles()).toEqual([]);
    expect(manager.getActiveProfileId()).toBeNull();
  });

  it('reassigns active profile after removing the active one', async () => {
    await manager.addProfile('@first:stack.cards', 'pass1');
    await manager.addProfile('@second:stack.cards', 'pass2');
    manager.switchProfile('@first:stack.cards');

    await manager.removeProfile('@first:stack.cards');

    expect(manager.getActiveProfileId()).toBe('@second:stack.cards');
  });

  it('returns false when removing nonexistent profile', async () => {
    expect(await manager.removeProfile('@nonexistent:stack.cards')).toBe(false);
  });

  it('persists profiles to disk', async () => {
    await manager.addProfile(
      '@testuser:stack.cards',
      'password123',
      'Test User',
    );

    // Create a new manager pointing at the same config dir
    const manager2 = new ProfileManager(tmpDir);
    expect(manager2.listProfiles()).toEqual(['@testuser:stack.cards']);
    expect(manager2.getActiveProfileId()).toBe('@testuser:stack.cards');

    const profile = manager2.getProfile('@testuser:stack.cards');
    expect(profile!.password).toBe('password123');
  });

  it('sets file permissions to 0600', async () => {
    await manager.addProfile('@testuser:stack.cards', 'password123');

    const profilesFile = path.join(tmpDir, 'profiles.json');
    const stats = fs.statSync(profilesFile);
    // Check owner-only permissions (0600 = 0o600 = 384 decimal)
    const mode = stats.mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('gets active credentials from profile', async () => {
    await manager.addProfile(
      '@testuser:stack.cards',
      'password123',
      'Test User',
    );

    const creds = await manager.getActiveCredentials();
    expect(creds).not.toBeNull();
    expect(creds!.username).toBe('testuser');
    expect(creds!.password).toBe('password123');
    expect(creds!.matrixUrl).toBe('https://matrix-staging.stack.cards');
    expect(creds!.realmServerUrl).toBe('https://realms-staging.stack.cards/');
    expect(creds!.profileId).toBe('@testuser:stack.cards');
  });

  it('returns null credentials when no profile and no env vars', async () => {
    const creds = await manager.getActiveCredentials();
    expect(creds).toBeNull();
  });

  it('updates password for existing profile', async () => {
    await manager.addProfile('@testuser:stack.cards', 'oldpass');

    expect(
      await manager.updatePassword('@testuser:stack.cards', 'newpass'),
    ).toBe(true);

    const profile = manager.getProfile('@testuser:stack.cards');
    expect(profile!.password).toBe('newpass');
  });

  it('updates display name for existing profile', async () => {
    await manager.addProfile('@testuser:stack.cards', 'pass', 'Old Name');

    expect(manager.updateDisplayName('@testuser:stack.cards', 'New Name')).toBe(
      true,
    );

    const profile = manager.getProfile('@testuser:stack.cards');
    expect(profile!.displayName).toBe('New Name');
  });

  it('handles corrupted config file gracefully', async () => {
    // Write invalid JSON to the config file
    const profilesFile = path.join(tmpDir, 'profiles.json');
    fs.writeFileSync(profilesFile, 'not valid json{{{');

    // Should start fresh without throwing
    const freshManager = new ProfileManager(tmpDir);
    expect(freshManager.listProfiles()).toEqual([]);
  });
});

describe('environment helpers', () => {
  it('detects staging environment', () => {
    expect(getEnvironmentFromMatrixId('@user:stack.cards')).toBe('staging');
  });

  it('detects production environment', () => {
    expect(getEnvironmentFromMatrixId('@user:boxel.ai')).toBe('production');
  });

  it('detects unknown environment', () => {
    expect(getEnvironmentFromMatrixId('@user:other.domain')).toBe('unknown');
  });

  it('extracts username from matrix ID', () => {
    expect(getUsernameFromMatrixId('@ctse:stack.cards')).toBe('ctse');
    expect(getUsernameFromMatrixId('@aallen90:boxel.ai')).toBe('aallen90');
  });

  it('extracts domain from matrix ID', () => {
    expect(getDomainFromMatrixId('@user:stack.cards')).toBe('stack.cards');
    expect(getDomainFromMatrixId('@user:boxel.ai')).toBe('boxel.ai');
  });

  it('returns correct short labels', () => {
    expect(getEnvironmentShortLabel('staging')).toBe('stack.cards');
    expect(getEnvironmentShortLabel('production')).toBe('boxel.ai');
    expect(getEnvironmentShortLabel('unknown')).toBe('unknown');
  });
});
