import { baseRealm, type ResolvedCodeRef } from './index';

export const FILEDEF_CODE_REF_BY_EXTENSION: Record<string, ResolvedCodeRef> = {
  // TODO: Replace with realm metadata configuration.
  '.markdown': {
    module: `${baseRealm.url}markdown-file-def`,
    name: 'MarkdownDef',
  },
  '.md': {
    module: `${baseRealm.url}markdown-file-def`,
    name: 'MarkdownDef',
  },
  '.mismatch': { module: './filedef-mismatch', name: 'FileDef' },
};

export const BASE_FILE_DEF_CODE_REF: ResolvedCodeRef = {
  module: `${baseRealm.url}file-api`,
  name: 'FileDef',
};

export function resolveFileDefCodeRef(fileURL: URL): ResolvedCodeRef {
  let name = fileURL.pathname.split('/').pop() ?? '';
  let dot = name.lastIndexOf('.');
  let extension = dot === -1 ? '' : name.slice(dot).toLowerCase();
  let mapping = extension
    ? FILEDEF_CODE_REF_BY_EXTENSION[extension]
    : undefined;
  if (!mapping) {
    return BASE_FILE_DEF_CODE_REF;
  }
  if (mapping.module.includes('://')) {
    return mapping;
  }
  return {
    ...mapping,
    module: new URL(mapping.module, fileURL).href,
  };
}
