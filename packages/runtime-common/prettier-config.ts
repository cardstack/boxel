// This module provides configuration resolution for prettier integration

import type { Options as PrettierOptions } from 'prettier';

export interface PrettierConfig extends PrettierOptions {
  parser?: string;
  plugins?: string[];
  singleQuote?: boolean;
  printWidth?: number;
  tabWidth?: number;
  useTabs?: boolean;
  semi?: boolean;
  [key: string]: any;
}

interface FileTypeInfo {
  type: string;
  parser: string;
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Default prettier configuration based on project settings
 */
const DEFAULT_PRETTIER_CONFIG: PrettierConfig = {
  singleQuote: true,
  plugins: ['prettier-plugin-ember-template-tag'],
  parser: 'ember-template-tag',
  printWidth: 80,
  tabWidth: 2,
  useTabs: false,
  semi: true,
};

/**
 * Resolves prettier configuration from project root
 * This function will be enhanced to actually load from .prettierrc.js
 */
export async function resolvePrettierConfig(
  filename: string = 'input.gts',
): Promise<PrettierConfig> {
  try {
    // Try to load prettier configuration from the project root
    const prettier = await import(/* webpackIgnore: true */ 'prettier');

    // Use prettier's built-in config resolution
    const resolvedConfig = await prettier.resolveConfig(filename, {
      useCache: true,
    });

    const fileInfo = detectFileType(filename);

    // Merge resolved config with defaults and ensure correct parser
    return {
      ...DEFAULT_PRETTIER_CONFIG,
      ...resolvedConfig,
      parser: fileInfo.parser,
      plugins: ['prettier-plugin-ember-template-tag'],
    };
  } catch (error) {
    // Fallback to defaults if config resolution fails
    return handleMissingConfig(filename);
  }
}

/**
 * Handles missing prettier config by returning sensible defaults
 */
export async function handleMissingConfig(
  filename: string = 'input.gts',
): Promise<PrettierConfig> {
  const fileInfo = detectFileType(filename);

  return {
    ...DEFAULT_PRETTIER_CONFIG,
    parser: fileInfo.parser,
  };
}

/**
 * Merges user options with project configuration
 * User options take precedence over project config
 */
export function mergeConfigWithUserOptions(
  projectConfig: PrettierConfig,
  userOptions: Partial<PrettierConfig>,
): PrettierConfig {
  return {
    ...projectConfig,
    ...userOptions,
  };
}

/**
 * Validates prettier configuration options
 */
export function validatePrettierConfig(config: PrettierConfig): string[] {
  const validParsers = ['ember-template-tag', 'typescript', 'babel'];
  const errors: string[] = [];

  if (config.parser && !validParsers.includes(config.parser)) {
    errors.push(`Invalid parser: ${config.parser}`);
  }

  if (
    config.printWidth &&
    (typeof config.printWidth !== 'number' || config.printWidth < 0)
  ) {
    errors.push(`Invalid printWidth: ${config.printWidth}`);
  }

  if (
    config.tabWidth &&
    (typeof config.tabWidth !== 'number' || config.tabWidth < 0)
  ) {
    errors.push(`Invalid tabWidth: ${config.tabWidth}`);
  }

  return errors;
}

/**
 * Detects file type from filename extension
 */
export function detectFileType(filename: string): FileTypeInfo {
  const extension = filename.split('.').pop()?.toLowerCase();

  switch (extension) {
    case 'gts':
      return { type: 'gts', parser: 'ember-template-tag', confidence: 'high' };
    case 'ts':
      return { type: 'typescript', parser: 'typescript', confidence: 'high' };
    case 'js':
      return { type: 'javascript', parser: 'babel', confidence: 'high' };
    default:
      return {
        type: 'unknown',
        parser: 'ember-template-tag',
        confidence: 'low',
      };
  }
}

/**
 * Detects GTS content from source code
 */
export function detectGTSFromContent(source: string): boolean {
  const hasTemplateTag = /<template\s*>/.test(source);
  const hasComponentImport = /import.*Component.*from/.test(source);
  const hasCardDef = /extends\s+CardDef/.test(source);

  return hasTemplateTag || (hasComponentImport && hasCardDef);
}

/**
 * Robust file type detection combining filename and content analysis
 */
export function robustFileTypeDetection(
  filename: string,
  content: string = '',
): FileTypeInfo {
  // Primary detection from filename
  if (filename.endsWith('.gts')) {
    return { type: 'gts', parser: 'ember-template-tag', confidence: 'high' };
  }

  // Secondary detection from content
  if (content.includes('<template>')) {
    return { type: 'gts', parser: 'ember-template-tag', confidence: 'medium' };
  }

  // Fallback based on extension
  if (filename.endsWith('.ts')) {
    return {
      type: 'typescript',
      parser: 'typescript',
      confidence: 'low',
    };
  }

  // Default fallback
  return { type: 'unknown', parser: 'ember-template-tag', confidence: 'low' };
}

/**
 * Caches resolved configurations to improve performance
 */
export class ConfigCache {
  private cache = new Map<string, PrettierConfig>();

  async getConfig(filename: string): Promise<PrettierConfig> {
    const cacheKey = filename || 'default';

    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    const config = await resolvePrettierConfig(filename);
    this.cache.set(cacheKey, config);

    return config;
  }

  clearCache(): void {
    this.cache.clear();
  }
}

// Global config cache instance
export const configCache = new ConfigCache();
