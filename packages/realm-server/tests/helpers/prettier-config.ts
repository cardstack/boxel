// Prettier configuration for test environment
export const TEST_PRETTIER_CONFIG = {
  singleQuote: true,
  plugins: ['prettier-plugin-ember-template-tag'],
  parser: 'glimmer' as const,
  printWidth: 80,
  tabWidth: 2,
  useTabs: false,
  semi: true,
  trailingComma: 'all' as const,
  bracketSpacing: true,
  arrowParens: 'avoid' as const,
};

export const PRETTIER_PARSERS = {
  '.gts': 'glimmer',
  '.ts': 'typescript',
  '.js': 'babel',
} as const;

export function inferPrettierParser(filename: string): string {
  const extension = filename.substring(filename.lastIndexOf('.'));
  return (
    PRETTIER_PARSERS[extension as keyof typeof PRETTIER_PARSERS] || 'glimmer'
  );
}

export function createPrettierConfig(overrides: Record<string, any> = {}) {
  return {
    ...TEST_PRETTIER_CONFIG,
    ...overrides,
  };
}
