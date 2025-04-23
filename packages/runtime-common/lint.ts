import type { Linter } from 'eslint';

export interface LintArgs {
  source: string;
}

export type LintResult = Linter.FixReport;

export async function lintFix({ source }: LintArgs): Promise<LintResult> {
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

  const CONFIG: any = [
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
      },
    },
  ];
  const linter = new eslintModule.Linter({ configType: 'flat' });
  let fixReport = linter.verifyAndFix(source, CONFIG, 'input.gts');
  return fixReport;
}
