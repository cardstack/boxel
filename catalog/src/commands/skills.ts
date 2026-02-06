import * as fs from 'fs';
import * as path from 'path';
import { MatrixClient } from '../lib/matrix-client.js';
import { RealmAuthClient } from '../lib/realm-auth-client.js';
import { getProfileManager, formatProfileBadge, getEnvironmentFromMatrixId } from '../lib/profile-manager.js';

interface SkillCard {
  id: string;
  title: string;
  instructions: string;
  description?: string;
  realmUrl: string;
}

interface SkillsManifest {
  skills: SkillCard[];
  enabledSkillIds: string[];
  lastFetched: number;
}

const SKILL_TYPE = {
  module: 'https://cardstack.com/base/skill',
  name: 'Skill',
};

const BASE_REALMS = [
  'https://app.boxel.ai/base/',
  'https://app.boxel.ai/catalog/',
  'https://app.boxel.ai/skills/',
];

const STAGING_REALMS = [
  'https://realms-staging.stack.cards/base/',
  'https://realms-staging.stack.cards/catalog/',
  'https://realms-staging.stack.cards/skills/',
];

// Default skill for vibe coding - auto-enabled on first refresh
const DEFAULT_SKILL_ID = {
  production: 'https://app.boxel.ai/skills/Skill/boxel-development',
  staging: 'https://realms-staging.stack.cards/skills/Skill/boxel-development',
};

export interface SkillsOptions {
  list?: boolean;
  enable?: string;
  disable?: string;
  refresh?: boolean;
  export?: string;
  realm?: string;
}

async function fetchSkillsFromRealm(
  realmUrl: string,
  jwt?: string,
  isReadOnly: boolean = false
): Promise<SkillCard[]> {
  // Construct URL properly
  const searchUrl = new URL('./_search', realmUrl).toString();

  // Note: vscode-boxel-tools uses a sort by title, but staging realms don't support it
  // We skip sorting to support both staging and production
  const query = {
    filter: {
      type: SKILL_TYPE,
    },
  };

  const headers: Record<string, string> = {
    'Accept': 'application/vnd.card+json',
  };

  // Only add auth for non-read-only realms
  if (!isReadOnly && jwt) {
    headers['Authorization'] = jwt;
  }

  try {
    // Use QUERY method (custom HTTP method used by Boxel)
    const response = await fetch(searchUrl, {
      method: 'QUERY',
      headers,
      body: JSON.stringify(query),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      console.error(`  Failed to fetch skills from ${realmUrl}: ${response.status} ${errorText.slice(0, 100)}`);
      return [];
    }

    const data = await response.json();
    return parseSkillsResponse(data, realmUrl);
  } catch (error) {
    console.error(`  Error fetching skills from ${realmUrl}:`, error);
    return [];
  }
}

function parseSkillsResponse(data: any, realmUrl: string): SkillCard[] {
  if (!data.data || !Array.isArray(data.data)) {
    return [];
  }

  return data.data.map((card: any, index: number) => {
    // Debug: log first card's full attributes
    if (process.env.DEBUG && index === 0) {
      console.log('First card ID:', card.id);
      console.log('First card attributes:', JSON.stringify(card.attributes, null, 2));
    }

    // Title is at cardTitle (from compiled card) or title (from raw card)
    const title = card.attributes?.cardTitle ||
                  card.attributes?.title ||
                  extractTitleFromInstructions(card.attributes?.instructions) ||
                  'Untitled Skill';

    return {
      id: card.id,
      title,
      instructions: card.attributes?.instructions || '',
      description: card.attributes?.description,
      realmUrl,
    };
  });
}

function extractTitleFromInstructions(instructions: string | undefined): string | undefined {
  if (!instructions) return undefined;

  // Try to extract title from markdown heading
  const match = instructions.match(/^#\s+(.+?)(?:\n|$)/);
  if (match) {
    return match[1].replace(/[🎯⛩️🏆🔭🛰️]/g, '').trim();
  }

  return undefined;
}

function getSkillsManifestPath(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
  const claudeDir = path.join(homeDir, '.claude', 'boxel-skills');

  if (!fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true });
  }

  return path.join(claudeDir, 'skills-manifest.json');
}

function loadSkillsManifest(): SkillsManifest {
  const manifestPath = getSkillsManifestPath();

  if (fs.existsSync(manifestPath)) {
    try {
      return JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    } catch {
      // Corrupted, start fresh
    }
  }

  return {
    skills: [],
    enabledSkillIds: [],
    lastFetched: 0,
  };
}

function saveSkillsManifest(manifest: SkillsManifest): void {
  const manifestPath = getSkillsManifestPath();
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

function exportSkillsToClaudeCommands(manifest: SkillsManifest, targetDir: string): void {
  const commandsDir = path.join(targetDir, '.claude', 'commands');

  if (!fs.existsSync(commandsDir)) {
    fs.mkdirSync(commandsDir, { recursive: true });
  }

  const enabledSkills = manifest.skills.filter(s =>
    manifest.enabledSkillIds.includes(s.id)
  );

  for (const skill of enabledSkills) {
    // Create a valid filename from the skill title
    const filename = skill.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') + '.md';

    const skillPath = path.join(commandsDir, filename);

    // Write the skill as a Claude command file
    const content = `# ${skill.title}

${skill.description ? `> ${skill.description}\n\n` : ''}${skill.instructions}

---
*Source: ${skill.realmUrl}*
*Skill ID: ${skill.id}*
`;

    fs.writeFileSync(skillPath, content);
    console.log(`  Exported: ${filename}`);
  }
}

export async function skillsCommand(options: SkillsOptions): Promise<void> {
  const manifest = loadSkillsManifest();

  // Refresh skills from server (requires credentials)
  if (options.refresh || manifest.skills.length === 0) {
    // Get credentials from profile manager (falls back to env vars)
    const profileManager = getProfileManager();
    const credentials = await profileManager.getActiveCredentials();

    if (!credentials) {
      if (options.refresh) {
        console.error('No credentials found. Run "boxel profile add" or set environment variables.');
        process.exit(1);
      } else {
        console.log('No skills cached. Run "boxel skills --refresh" with credentials to fetch skills.');
        return;
      }
    }

    const { matrixUrl, username, password, profileId } = credentials;

    // Show active profile if using one
    if (profileId) {
      console.log(`${formatProfileBadge(profileId)}\n`);
    }

    // Determine which realms to use based on profile environment
    const isStaging = profileId ? getEnvironmentFromMatrixId(profileId) === 'staging' : matrixUrl.includes('staging');
    const baseRealms = isStaging ? STAGING_REALMS : BASE_REALMS;
    console.log('Fetching skills from Boxel...\n');

    const matrixClient = new MatrixClient({
      matrixURL: new URL(matrixUrl),
      username,
      password,
    });

    await matrixClient.login();

    const allSkills: SkillCard[] = [];
    const realmsToFetch = options.realm ? [options.realm] : baseRealms;

    for (const realmUrl of realmsToFetch) {
      console.log(`Fetching from: ${realmUrl}`);

      // Base realms are read-only (no auth needed)
      const isReadOnly = baseRealms.includes(realmUrl) || STAGING_REALMS.includes(realmUrl);

      let jwt: string | undefined;
      if (!isReadOnly) {
        const realmAuth = new RealmAuthClient(new URL(realmUrl), matrixClient);
        jwt = await realmAuth.getJWT();
      }

      const skills = await fetchSkillsFromRealm(realmUrl, jwt, isReadOnly);
      console.log(`  Found ${skills.length} skills`);

      allSkills.push(...skills);
    }

    manifest.skills = allSkills;
    manifest.lastFetched = Date.now();

    // Auto-enable the default boxel-development skill if not already set
    const defaultSkillId = isStaging ? DEFAULT_SKILL_ID.staging : DEFAULT_SKILL_ID.production;
    const defaultSkill = allSkills.find(s => s.id === defaultSkillId);
    if (defaultSkill && !manifest.enabledSkillIds.includes(defaultSkillId)) {
      manifest.enabledSkillIds.push(defaultSkillId);
      console.log(`\n✓ Auto-enabled default skill: ${defaultSkill.title}`);
    }

    saveSkillsManifest(manifest);

    console.log(`\nTotal: ${allSkills.length} skills fetched`);
  }

  // List skills
  if (options.list || (!options.enable && !options.disable && !options.export)) {
    console.log('\n📚 Available Skills:\n');

    // Group by realm
    const byRealm = new Map<string, SkillCard[]>();
    for (const skill of manifest.skills) {
      const existing = byRealm.get(skill.realmUrl) || [];
      existing.push(skill);
      byRealm.set(skill.realmUrl, existing);
    }

    for (const [realmUrl, skills] of byRealm) {
      console.log(`\n${realmUrl}`);
      console.log('─'.repeat(60));

      for (const skill of skills) {
        const enabled = manifest.enabledSkillIds.includes(skill.id);
        const marker = enabled ? '✓' : ' ';
        const preview = skill.instructions.slice(0, 80).replace(/\n/g, ' ');
        console.log(`  [${marker}] ${skill.title}`);
        console.log(`      ${preview}...`);
      }
    }

    console.log(`\nEnabled: ${manifest.enabledSkillIds.length} / ${manifest.skills.length}`);
    console.log('\nCommands:');
    console.log('  boxel skills --enable "Skill Name"');
    console.log('  boxel skills --disable "Skill Name"');
    console.log('  boxel skills --export ./project');
    console.log('  boxel skills --refresh');
  }

  // Enable a skill
  if (options.enable) {
    const skill = manifest.skills.find(s =>
      s.title.toLowerCase() === options.enable!.toLowerCase() ||
      s.id === options.enable
    );

    if (!skill) {
      console.error(`Skill not found: ${options.enable}`);
      console.log('Use "boxel skills --list" to see available skills');
      process.exit(1);
    }

    if (!manifest.enabledSkillIds.includes(skill.id)) {
      manifest.enabledSkillIds.push(skill.id);
      saveSkillsManifest(manifest);
      console.log(`✓ Enabled: ${skill.title}`);
    } else {
      console.log(`Already enabled: ${skill.title}`);
    }
  }

  // Disable a skill
  if (options.disable) {
    const skill = manifest.skills.find(s =>
      s.title.toLowerCase() === options.disable!.toLowerCase() ||
      s.id === options.disable
    );

    if (!skill) {
      console.error(`Skill not found: ${options.disable}`);
      process.exit(1);
    }

    const idx = manifest.enabledSkillIds.indexOf(skill.id);
    if (idx >= 0) {
      manifest.enabledSkillIds.splice(idx, 1);
      saveSkillsManifest(manifest);
      console.log(`✓ Disabled: ${skill.title}`);
    } else {
      console.log(`Already disabled: ${skill.title}`);
    }
  }

  // Export enabled skills to a project
  if (options.export) {
    const targetDir = path.resolve(options.export);

    if (!fs.existsSync(targetDir)) {
      console.error(`Directory not found: ${targetDir}`);
      process.exit(1);
    }

    const enabledCount = manifest.enabledSkillIds.length;
    if (enabledCount === 0) {
      console.log('No skills enabled. Use "boxel skills --enable <name>" first.');
      process.exit(1);
    }

    console.log(`\nExporting ${enabledCount} skills to ${targetDir}/.claude/commands/\n`);
    exportSkillsToClaudeCommands(manifest, targetDir);
    console.log(`\n✓ Exported ${enabledCount} skills as Claude Code commands`);
  }
}
