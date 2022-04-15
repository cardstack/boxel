import { languages } from 'monaco-editor/esm/vs/editor/editor.api';

export function getEditorLanguage(fileName: string) {
  const editorLanguages = languages.getLanguages();
  let extension = '.' + fileName.split('.').pop();
  let language = editorLanguages.find((lang) => {
    return lang.extensions?.find((ext) => (ext === extension ? lang : null));
  });
  return language?.id ?? 'plaintext';
}

export function registerMonacoLanguage(
  languageInfo: languages.ILanguageExtensionPoint,
  definition: languages.IMonarchLanguage,
  config?: languages.LanguageConfiguration
) {
  const { id, extensions } = languageInfo;
  languages.register({ id, extensions });
  languages.setMonarchTokensProvider(id, definition);
  if (config) {
    languages.setLanguageConfiguration(id, config);
  }
}
