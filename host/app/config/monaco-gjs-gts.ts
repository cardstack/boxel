import { languages } from 'monaco-editor';

const gjsConfig: languages.ILanguageExtensionPoint = {
  id: 'glimmerJS',
  extensions: ['.gjs'],
};

const gtsConfig: languages.ILanguageExtensionPoint = {
  id: 'glimmerTS',
  extensions: ['.gts'],
};

const hbsRules: languages.IMonarchLanguage = {
  tokenizer: {
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
    ],
    hbs: [
      [
        /<\/template\s*>/,
        { token: '@rematch', next: '@pop', nextEmbedded: '@pop' },
      ],
    ],
  },
};

export const gjsConfigForMonaco = {
  baseId: 'javascript',
  config: gjsConfig,
  rules: hbsRules,
};

export const gtsConfigForMonaco = {
  baseId: 'typescript',
  config: gtsConfig,
  rules: hbsRules,
};
