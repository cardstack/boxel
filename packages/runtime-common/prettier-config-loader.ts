// Phase 3.2 - Configuration Resolution Test Support
// This file provides additional configuration resolution utilities for testing

import type { PrettierConfig } from './prettier-config';

/**
 * Loads prettier configuration from project root
 * This will be enhanced in Phase 4 to actually read from .prettierrc.js
 */
export async function loadPrettierConfigFromProject(
  projectRoot: string = process.cwd(),
): Promise<PrettierConfig | null> {
  try {
    // Phase 4 will implement actual file system loading
    // For now, return the expected project configuration
    return {
      singleQuote: true,
      plugins: ['prettier-plugin-ember-template-tag'],
      overrides: [
        {
          files: ['*.yaml', '*.yml'],
          options: {
            singleQuote: false,
          },
        },
      ],
    };
  } catch (error) {
    // Return null if config file doesn't exist or can't be loaded
    return null;
  }
}

/**
 * Resolves per-file overrides from prettier configuration
 */
export function resolvePerFileOverrides(
  config: PrettierConfig,
  filename: string,
): PrettierConfig {
  const overrides = config.overrides || [];
  const fileExtension = filename.split('.').pop() || '';

  let resolvedConfig = { ...config };

  for (const override of overrides) {
    if (override.files) {
      const patterns = Array.isArray(override.files)
        ? override.files
        : [override.files];

      for (const pattern of patterns) {
        // Simple pattern matching for now
        if (pattern.includes(fileExtension)) {
          resolvedConfig = {
            ...resolvedConfig,
            ...override.options,
          };
        }
      }
    }
  }

  return resolvedConfig;
}

/**
 * Configuration resolution strategy for different file types
 */
export const CONFIG_RESOLUTION_STRATEGIES = {
  gts: {
    parser: 'glimmer',
    plugins: ['prettier-plugin-ember-template-tag'],
    singleQuote: true,
  },
  ts: {
    parser: 'typescript',
    singleQuote: true,
  },
  js: {
    parser: 'babel',
    singleQuote: true,
  },
} as const;

/**
 * Gets appropriate configuration strategy for file type
 */
export function getConfigStrategy(fileType: string): Partial<PrettierConfig> {
  return (
    CONFIG_RESOLUTION_STRATEGIES[
      fileType as keyof typeof CONFIG_RESOLUTION_STRATEGIES
    ] || CONFIG_RESOLUTION_STRATEGIES.gts
  );
}
