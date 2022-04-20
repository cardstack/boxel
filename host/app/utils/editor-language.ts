import { languages } from 'monaco-editor';

type LanguageInfo = languages.ILanguageExtensionPoint;
type LanguageConfig = languages.LanguageConfiguration;
type LanguageDefinition = languages.IMonarchLanguage;

export function getEditorLanguage(fileName: string): string | undefined {
  const editorLanguages = languages.getLanguages();
  console.log(editorLanguages);
  let extension = '.' + fileName.split('.').pop();
  let language = editorLanguages.find((lang) => {
    return lang.extensions?.find((ext) => (ext === extension ? lang : null));
  });
  return language?.id ?? 'plaintext';
}

export const extendMonacoLanguage = async function (
  baseId: string,
  langInfo: LanguageInfo,
  rules: LanguageDefinition
) {
  const baseLanguage = languages
    .getLanguages()
    .find((lang) => lang.id === baseId);
  // @ts-ignore-next-line
  let { conf, language } = await baseLanguage?.loader();
  let extendedConfig = extendConfig(conf);
  let extendedDef = extendDefinition(language, rules);
  let { id } = langInfo;
  console.log(extendedDef);
  languages.register(langInfo);
  languages.setMonarchTokensProvider(id, extendedDef);
  languages.setLanguageConfiguration(id, extendedConfig);
};

function extendConfig(config: LanguageConfig): LanguageConfig {
  return {
    ...config,
    autoClosingPairs: [
      { open: '<!--', close: '-->', notIn: ['comment', 'string'] },
      { open: '<template>', close: '</template>' },
      ...config.autoClosingPairs,
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
