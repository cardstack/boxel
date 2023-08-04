import type { languages } from 'monaco-editor';

type LanguageInfo = languages.ILanguageExtensionPoint;
type LanguageConfig = languages.LanguageConfiguration;
type LanguageDefinition = languages.IMonarchLanguage;

export type MonacoLanguageConfig = {
  baseId: string;
  langInfo: LanguageInfo;
  rules: LanguageDefinition;
};

const gjsConfig: LanguageInfo = {
  id: 'glimmerJS',
  extensions: ['.gjs'],
};

const gtsConfig: LanguageInfo = {
  id: 'glimmerTS',
  extensions: ['.gts'],
};

const rules: LanguageDefinition = {
  tokenizer: {
    root: [
      [
        // The unnecessary square brackets here are tricking
        // ember-template-imports into not accidentally treating this as a
        // template tag. Which is only relevant during ember-template-lint,
        // since during the actual build ember-template-imports does not look at
        // .ts files.
        // https://github.com/ember-template-imports/ember-template-imports/pull/155
        /<[t]emplate\s*>/,
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

export const languageConfigs = [
  {
    baseId: 'javascript',
    langInfo: gjsConfig,
    rules,
  },
  {
    baseId: 'typescript',
    langInfo: gtsConfig,
    rules,
  },
];

export function extendDefinition(
  baseLanguage: LanguageDefinition,
  newLanguage: LanguageDefinition,
): LanguageDefinition {
  return {
    ...baseLanguage,
    tokenizer: {
      ...baseLanguage.tokenizer,
      ...newLanguage.tokenizer,
      root: [...newLanguage.tokenizer.root, ...baseLanguage.tokenizer.root],
    },
  };
}

export function extendConfig(config: LanguageConfig): LanguageConfig {
  return {
    ...config,
    autoClosingPairs: [
      { open: '<!--', close: '-->', notIn: ['comment', 'string'] },
      { open: '<template>', close: '</template>' },
      ...(config.autoClosingPairs as languages.IAutoClosingPairConditional[]),
    ],
  };
}
