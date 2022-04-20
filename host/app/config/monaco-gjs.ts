import { languages } from 'monaco-editor';

export const getLanguageConfig = async function (
  id: string,
  registryInfo: languages.ILanguageExtensionPoint,
  postfix: string
): Promise<{
  info: languages.ILanguageExtensionPoint;
  config: languages.LanguageConfiguration;
  language: languages.IMonarchLanguage;
}> {
  const baseLanguage = languages.getLanguages().find((lang) => lang.id === id);
  let { conf, language } = await baseLanguage?.loader();
  return {
    info: registryInfo,
    config: updatedConfig(conf),
    language: updatedDefinition(language, postfix),
  };
};

export const gjsRegistryInfo: languages.ILanguageExtensionPoint = {
  id: 'glimmerJS',
  extensions: ['.gjs'],
};

export const gtsRegistryInfo: languages.ILanguageExtensionPoint = {
  id: 'glimmerTS',
  extensions: ['.gts'],
};

function updatedConfig(
  config: languages.LanguageConfiguration
): languages.LanguageConfiguration {
  return {
    ...config,
    autoClosingPairs: [
      { open: '<!--', close: '-->', notIn: ['comment', 'string'] },
      { open: '<template>', close: '</template>' },
      // ...config.autoClosingPairs,
    ],
  };
}

function updatedDefinition(
  language: languages.IMonarchLanguage,
  postfix: string
): languages.IMonarchLanguage {
  return {
    ...language,
    tokenPostfix: postfix,
    tokenizer: {
      ...language.tokenizer,
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
        ...language.tokenizer.root,
      ],
      hbs: [
        [
          /<\/template\s*>/,
          { token: '@rematch', next: '@pop', nextEmbedded: '@pop' },
        ],
      ],
    },
  };
}
