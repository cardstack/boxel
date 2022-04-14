import * as monaco from 'monaco-editor';

export function getEditorLanguage(fileName: string) {
  const languages = monaco.languages.getLanguages();
  let extension = '.' + fileName.split('.').pop();
  let language = languages.find((lang) => {
    if (!lang.extensions || lang.extensions.length === 0) {
      return;
    }
    return lang.extensions.find((ext) => (ext === extension ? lang : null));
  });

  if (!language) {
    return 'plaintext';
  }
  return language.id;
}

export function registerMonacoLanguage(
  languageInfo: monaco.languages.ILanguageExtensionPoint,
  definition: monaco.languages.IMonarchLanguage
) {
  const { id, extensions } = languageInfo;
  monaco.languages.register({ id, extensions });
  monaco.languages.setMonarchTokensProvider(id, definition);
}
