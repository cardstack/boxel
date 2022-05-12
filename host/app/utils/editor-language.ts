import { languages } from 'monaco-editor';

type LanguageInfo = languages.ILanguageExtensionPoint;
type LanguageConfig = languages.LanguageConfiguration;
type LanguageDefinition = languages.IMonarchLanguage;

type MonacoLanguageConfig = {
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

export async function extendMonacoLanguage({
  baseId,
  langInfo,
  rules,
}: MonacoLanguageConfig) {
  const baseLanguage = languages
    .getLanguages()
    .find((lang) => lang.id === baseId);

  // @ts-ignore-next-line
  let { conf, language } = await baseLanguage?.loader();

  let extendedConfig = extendConfig(conf);
  let extendedDef = extendDefinition(language, rules);
  let { id } = langInfo;

  languages.register(langInfo);
  languages.setMonarchTokensProvider(id, extendedDef);
  languages.setLanguageConfiguration(id, extendedConfig);
}

function extendConfig(config: LanguageConfig): LanguageConfig {
  return {
    ...config,
    autoClosingPairs: [
      { open: '<!--', close: '-->', notIn: ['comment', 'string'] },
      { open: '<template>', close: '</template>' },
      ...(config.autoClosingPairs as languages.IAutoClosingPairConditional[]),
    ],
  };
}

function extendDefinition(
  baseLanguage: LanguageDefinition,
  newLanguage: LanguageDefinition
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

export function getLangFromFileExtension(fileName: string): string {
  const editorLanguages = languages.getLanguages();
  let extension = '.' + fileName.split('.').pop();
  let language = editorLanguages.find((lang) =>
    lang.extensions?.find((ext) => ext === extension)
  );
  return language?.id ?? 'plaintext';
}
