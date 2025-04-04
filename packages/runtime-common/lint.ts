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
    // @ts-ignore no types for eslint-plugin-ember
    /* webpackIgnore: true */ 'eslint-plugin-ember'
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
        ember: pluginModule.default,
      },
      rules: {
        'no-undef': 'off',
        'ember/template-no-let-reference': 'off',
        'ember/no-tracked-properties-from-args': 'off',
        'ember/no-runloop': 'off',
        'ember/template-missing-invokable': [
          'error',
          {
            invokables: {
              fn: ['fn', '@ember/helper'],
              on: ['on', '@ember/modifier'],
              and: ['and', '@cardstack/boxel-ui/helpers'],
              bool: ['bool', '@cardstack/boxel-ui/helpers'],
              eq: ['eq', '@cardstack/boxel-ui/helpers'],
              gt: ['gt', '@cardstack/boxel-ui/helpers'],
              lt: ['lt', '@cardstack/boxel-ui/helpers'],
              not: ['not', '@cardstack/boxel-ui/helpers'],
              or: ['or', '@cardstack/boxel-ui/helpers'],
              add: ['add', '@cardstack/boxel-ui/helpers'],
              subtract: ['subtract', '@cardstack/boxel-ui/helpers'],
            },
          },
        ],
      },
    },
  ];
  const linter = new eslintModule.Linter({ configType: 'flat' });
  let fixReport = linter.verifyAndFix(source, CONFIG, 'input.gts');
  return fixReport;
}
