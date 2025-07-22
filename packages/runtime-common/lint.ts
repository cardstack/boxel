import type { Linter } from 'eslint';
import { resolvePrettierConfig } from './prettier-config';

export interface LintArgs {
  source: string;
  filename?: string; // Added to support parser detection
}

export type LintResult = Linter.FixReport;

export async function lintFix({
  source,
  filename = 'input.gts',
}: LintArgs): Promise<Pick<LintResult, 'output'>> {
  if (typeof (globalThis as any).document !== 'undefined') {
    throw new Error(
      'Linting is not supported in the browser environment. Please run this in a Node.js environment.',
    );
  }
  const eslintModule = await import(/* webpackIgnore: true */ 'eslint');
  const parserModule = await import(
    // @ts-ignore no types for ember-eslint-parser
    /* webpackIgnore: true */ 'ember-eslint-parser'
  );
  const pluginModule = await import(
    // @ts-ignore no types for @cardstack/eslint-plugin-boxel
    /* webpackIgnore: true */ '@cardstack/eslint-plugin-boxel'
  );

  // Import the shared invokables configuration
  const missingInvokablesConfig = await import(
    // @ts-ignore no types for missing-invokables-config
    /* webpackIgnore: true */ './etc/eslint/missing-invokables-config.js'
  );
  const missingCardApiImportConfig = await import(
    // @ts-ignore no types for missing-invokables-config
    /* webpackIgnore: true */ './etc/eslint/missing-card-api-import-config.js'
  );

  const LINT_CONFIG: any = [
    {
      files: ['**/*.gts', '**/*.ts'],
      languageOptions: {
        parser: parserModule.default,
        parserOptions: {
          ecmaVersion: 'latest',
          sourceType: 'module',
          requireConfigFile: false,
          babelOptions: {
            plugins: [
              [
                '@babel/plugin-proposal-decorators',
                { decoratorsBeforeExport: true },
              ],
            ],
          },
          warnOnUnsupportedTypeScriptVersion: false,
        },
      },
      plugins: {
        '@cardstack/boxel': pluginModule.default,
      },
      rules: {
        'no-undef': 'off',
        '@cardstack/boxel/template-missing-invokable': [
          'error',
          {
            invokables: missingInvokablesConfig.default.invokables,
          },
        ],
        '@cardstack/boxel/missing-card-api-import': [
          'error',
          {
            importMappings: missingCardApiImportConfig.default.importMappings,
          },
        ],
        '@cardstack/boxel/no-duplicate-imports': 'error',
      },
    },
  ];

  // Step 1: Run existing ESLint fixes (preserving current functionality)
  const linter = new eslintModule.Linter({ configType: 'flat' });
  let eslintResult = linter.verifyAndFix(source, LINT_CONFIG, filename);
  let { output: eslintOutput } = eslintResult;

  // Step 2: Apply Prettier formatting to the ESLint output
  try {
    const prettier = await import(/* webpackIgnore: true */ 'prettier');

    // Resolve prettier configuration
    const prettierConfig = await resolvePrettierConfig(filename);

    // Step 3: Apply prettier formatting
    const formattedOutput = await prettier.format(eslintOutput, prettierConfig);

    // Step 4: Return combined result with properly formatted code
    return { output: formattedOutput };
  } catch (error) {
    // Step 5: Handle errors gracefully with fallback behavior
    console.warn(
      'Prettier formatting failed, falling back to ESLint-only output:',
      error && typeof error === 'object' && 'message' in error
        ? (error as any).message
        : error,
    );
    return { output: eslintOutput };
  }
}
