import * as fs from 'fs';
import * as path from 'path';

export interface RealmConfig {
  path: string;
  name?: string;
  purpose?: string;
  patterns?: string[];      // File patterns this realm handles (e.g., "*.gts", "components/**")
  cardTypes?: string[];     // Card types that belong here
  notes?: string;           // Free-form notes for LLM guidance
}

export interface WorkspacesConfig {
  defaultRealm?: string;    // Path to default realm for ambiguous cases
  realms: RealmConfig[];
}

const CONFIG_FILENAME = '.boxel-workspaces.json';

export function findConfigPath(startDir: string = process.cwd()): string | null {
  let dir = path.resolve(startDir);

  while (dir !== path.dirname(dir)) {
    const configPath = path.join(dir, CONFIG_FILENAME);
    if (fs.existsSync(configPath)) {
      return configPath;
    }
    dir = path.dirname(dir);
  }

  return null;
}

export function getConfigPath(dir: string = process.cwd()): string {
  return path.join(dir, CONFIG_FILENAME);
}

export function loadConfig(configPath?: string): WorkspacesConfig | null {
  const resolvedPath = configPath || findConfigPath();
  if (!resolvedPath || !fs.existsSync(resolvedPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(resolvedPath, 'utf-8');
    return JSON.parse(content) as WorkspacesConfig;
  } catch {
    return null;
  }
}

export function saveConfig(config: WorkspacesConfig, configPath?: string): void {
  const resolvedPath = configPath || getConfigPath();
  fs.writeFileSync(resolvedPath, JSON.stringify(config, null, 2));
}

export function initConfig(dir: string = process.cwd()): WorkspacesConfig {
  const config: WorkspacesConfig = {
    realms: []
  };
  saveConfig(config, getConfigPath(dir));
  return config;
}

export function addRealm(config: WorkspacesConfig, realm: RealmConfig): WorkspacesConfig {
  // Check if realm already exists
  const existing = config.realms.findIndex(r => r.path === realm.path);
  if (existing >= 0) {
    // Update existing
    config.realms[existing] = { ...config.realms[existing], ...realm };
  } else {
    config.realms.push(realm);
  }
  return config;
}

export function removeRealm(config: WorkspacesConfig, realmPath: string): WorkspacesConfig {
  config.realms = config.realms.filter(r => r.path !== realmPath);
  return config;
}

export function getRealmForFile(config: WorkspacesConfig, filename: string): RealmConfig | null {
  // Check patterns
  for (const realm of config.realms) {
    if (realm.patterns) {
      for (const pattern of realm.patterns) {
        if (matchPattern(filename, pattern)) {
          return realm;
        }
      }
    }
  }

  // Return default realm if set
  if (config.defaultRealm) {
    return config.realms.find(r => r.path === config.defaultRealm) || null;
  }

  // Return first realm as fallback
  return config.realms[0] || null;
}

export function getRealmForCardType(config: WorkspacesConfig, cardType: string): RealmConfig | null {
  for (const realm of config.realms) {
    if (realm.cardTypes?.includes(cardType)) {
      return realm;
    }
  }

  // Return default realm if set
  if (config.defaultRealm) {
    return config.realms.find(r => r.path === config.defaultRealm) || null;
  }

  return config.realms[0] || null;
}

function matchPattern(filename: string, pattern: string): boolean {
  // Simple glob matching
  if (pattern === '*') return true;

  // Extension match: *.gts
  if (pattern.startsWith('*.')) {
    const ext = pattern.slice(1);
    return filename.endsWith(ext);
  }

  // Directory match: components/**
  if (pattern.endsWith('/**')) {
    const dir = pattern.slice(0, -3);
    return filename.startsWith(dir + '/') || filename.startsWith(dir);
  }

  // Exact match
  return filename === pattern;
}

export function formatRealmSummary(config: WorkspacesConfig): string {
  if (config.realms.length === 0) {
    return 'No realms configured.';
  }

  const lines: string[] = [];

  for (const realm of config.realms) {
    const isDefault = config.defaultRealm === realm.path;
    const name = realm.name || path.basename(realm.path);

    lines.push(`\n${isDefault ? '★ ' : '  '}${name} (${realm.path})`);

    if (realm.purpose) {
      lines.push(`    Purpose: ${realm.purpose}`);
    }
    if (realm.patterns?.length) {
      lines.push(`    Patterns: ${realm.patterns.join(', ')}`);
    }
    if (realm.cardTypes?.length) {
      lines.push(`    Card types: ${realm.cardTypes.join(', ')}`);
    }
    if (realm.notes) {
      lines.push(`    Notes: ${realm.notes}`);
    }
  }

  return lines.join('\n');
}

export function generateLLMGuidance(config: WorkspacesConfig): string {
  if (config.realms.length === 0) {
    return '';
  }

  const lines: string[] = [
    '## Active Realms',
    '',
    'The following Boxel realms are configured for this project:',
    ''
  ];

  for (const realm of config.realms) {
    const name = realm.name || path.basename(realm.path);
    const isDefault = config.defaultRealm === realm.path;

    lines.push(`### ${name}${isDefault ? ' (default)' : ''}`);
    lines.push(`Path: \`${realm.path}\``);

    if (realm.purpose) {
      lines.push(`Purpose: ${realm.purpose}`);
    }

    if (realm.patterns?.length) {
      lines.push(`File patterns: ${realm.patterns.map(p => `\`${p}\``).join(', ')}`);
    }

    if (realm.cardTypes?.length) {
      lines.push(`Card types: ${realm.cardTypes.join(', ')}`);
    }

    if (realm.notes) {
      lines.push(`\n${realm.notes}`);
    }

    lines.push('');
  }

  lines.push('When creating new files, use the realm that matches the file type or card type.');
  if (config.defaultRealm) {
    lines.push(`For ambiguous cases, use the default realm: \`${config.defaultRealm}\``);
  }

  return lines.join('\n');
}
