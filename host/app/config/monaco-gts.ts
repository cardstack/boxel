import {
  conf as tsConfig,
  language as ts,
} from 'monaco-editor/esm/vs/basic-languages/typescript/typescript';

export const gtsRegistryInfo = {
  id: 'glimmerTS',
  extensions: ['.gts'],
};

export const gtsConfig = {
  ...tsConfig,
  autoClosingPairs: [
    { open: '<!--', close: '-->', notIn: ['comment', 'string'] },
    { open: '<template>', close: '</template>' },
    ...tsConfig.autoClosingPairs,
  ],
};

export const gtsDefinition = {
  ...ts,
  tokenPostfix: '.gts',
  tokenizer: {
    ...ts.tokenizer,
    root: [
      [
        /<template\s*>/,
        {
          token: 'tag',
          bracket: '@open',
          next: '@hbs',
          nextEmbedded: 'handlebars',
        },
      ],
      [/<\/template\s*>/, { token: 'tag', bracket: '@close' }],
      ...ts.tokenizer.root,
    ],
    hbs: [
      [
        /<\/template\s*>/,
        { token: '@rematch', next: '@pop', nextEmbedded: '@pop' },
      ],
    ],
  },
};
