import { baseRealm, baseFileRef } from './constants';
import type { ResolvedCodeRef } from './code-ref';
import { resolveCardReference } from './card-reference-resolver';

export const BASE_FILE_DEF_CODE_REF = baseFileRef;

const FILEDEF_CODE_REF_BY_EXTENSION: Record<string, ResolvedCodeRef> = {
  // TODO: Replace with realm metadata configuration.
  '.markdown': {
    module: `${baseRealm.url}markdown-file-def`,
    name: 'MarkdownDef',
  },
  '.md': {
    module: `${baseRealm.url}markdown-file-def`,
    name: 'MarkdownDef',
  },
  '.png': {
    module: `${baseRealm.url}png-image-def`,
    name: 'PngDef',
  },
  '.jpg': {
    module: `${baseRealm.url}jpg-image-def`,
    name: 'JpgDef',
  },
  '.jpeg': {
    module: `${baseRealm.url}jpg-image-def`,
    name: 'JpgDef',
  },
  '.svg': {
    module: `${baseRealm.url}svg-image-def`,
    name: 'SvgDef',
  },
  '.gif': {
    module: `${baseRealm.url}gif-image-def`,
    name: 'GifDef',
  },
  '.webp': {
    module: `${baseRealm.url}webp-image-def`,
    name: 'WebpDef',
  },
  '.avif': {
    module: `${baseRealm.url}avif-image-def`,
    name: 'AvifDef',
  },
  '.ts': {
    module: `${baseRealm.url}ts-file-def`,
    name: 'TsFileDef',
  },
  '.gts': {
    module: `${baseRealm.url}gts-file-def`,
    name: 'GtsFileDef',
  },
  '.txt': {
    module: `${baseRealm.url}text-file-def`,
    name: 'TextFileDef',
  },
  '.text': {
    module: `${baseRealm.url}text-file-def`,
    name: 'TextFileDef',
  },
  '.json': {
    module: `${baseRealm.url}json-file-def`,
    name: 'JsonFileDef',
  },
  '.csv': {
    module: `${baseRealm.url}csv-file-def`,
    name: 'CsvFileDef',
  },
  '.mismatch': { module: './filedef-mismatch', name: 'FileDef' },
};

export function resolveFileDefCodeRef(fileURL: URL): ResolvedCodeRef {
  let name = fileURL.pathname.split('/').pop() ?? '';
  let dot = name.lastIndexOf('.');
  let extension = dot === -1 ? '' : name.slice(dot).toLowerCase();
  let mapping = extension
    ? FILEDEF_CODE_REF_BY_EXTENSION[extension]
    : undefined;
  if (!mapping) {
    return baseFileRef;
  }
  if (mapping.module.includes('://')) {
    return mapping;
  }
  return {
    ...mapping,
    module: resolveCardReference(mapping.module, fileURL),
  };
}
