import { ParserOptions, ParserPlugin } from '@babel/parser';

export type Overrides = Partial<{
  sourceType: ParserOptions['sourceType'];
  strictMode: ParserOptions['strictMode'];
  sourceFilename: ParserOptions['sourceFilename'];
}>;

export function getBabelOptions(
  options?: Overrides,
): ParserOptions & { plugins: ParserPlugin[] } {
  // The goal here is to tolerate as much syntax as possible, since Recast
  // is not in the business of forbidding anything. If you want your
  // parser to be more restrictive for some reason, you can always pass
  // your own parser object to recast.parse.
  return {
    sourceType: getOption(options, 'sourceType', 'module'),
    strictMode: getOption(options, 'strictMode', false),
    sourceFilename: getOption(options, 'sourceFilename', undefined),
    allowImportExportEverywhere: true,
    allowReturnOutsideFunction: true,
    startLine: 1,
    tokens: true,
    plugins: [
      'asyncGenerators',
      'bigInt',
      'classPrivateMethods',
      'classPrivateProperties',
      'classProperties',
      'classStaticBlock',
      'decimal',
      'decorators-legacy',
      'doExpressions',
      'dynamicImport',
      'exportDefaultFrom',
      'exportExtensions' as any as ParserPlugin,
      'exportNamespaceFrom',
      'functionBind',
      'functionSent',
      'importAssertions',
      'importMeta',
      'nullishCoalescingOperator',
      'numericSeparator',
      'objectRestSpread',
      'optionalCatchBinding',
      'optionalChaining',
      [
        'pipelineOperator',
        {
          proposal: 'minimal',
        },
      ] as any as ParserPlugin,
      [
        'recordAndTuple',
        {
          syntaxType: 'hash',
        },
      ],
      'throwExpressions',
      'typescript',
      'topLevelAwait',
      'v8intrinsic',
    ],
  };
}

const hasOwn = Object.prototype.hasOwnProperty;

function getOption(options: any, key: any, defaultValue: any) {
  if (options && hasOwn.call(options, key)) {
    return options[key];
  }
  return defaultValue;
}
