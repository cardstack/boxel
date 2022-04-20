import { languages } from 'monaco-editor';
import { getLanguageConfig } from '../config/monaco-gjs';

export function getEditorLanguage(fileName: string): string | undefined {
  const editorLanguages = languages.getLanguages();
  console.log(editorLanguages);
  let extension = '.' + fileName.split('.').pop();
  let language = editorLanguages.find((lang) => {
    return lang.extensions?.find((ext) => (ext === extension ? lang : null));
  });
  return language?.id ?? 'plaintext';
}

export async function registerMonacoLanguage(
  langId: string,
  registryInfo: languages.ILanguageExtensionPoint,
  postfix: string
) {
  let { info, config, language } = await getLanguageConfig(
    langId,
    registryInfo,
    postfix
  );
  let { id, extensions } = info;
  console.log(config, language);
  languages.register({ id, extensions });
  languages.setMonarchTokensProvider(id, language);
  languages.setLanguageConfiguration(id, config);
}
