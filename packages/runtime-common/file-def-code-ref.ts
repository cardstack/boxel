import { baseRealmPrefix, baseFileRef } from './constants';
import type { ResolvedCodeRef } from './code-ref';
import { resolveCardReference } from './card-reference-resolver';

export const BASE_FILE_DEF_CODE_REF = baseFileRef;

const FILEDEF_CODE_REF_BY_EXTENSION: Record<string, ResolvedCodeRef> = {
  // TODO: Replace with realm metadata configuration.
  '.markdown': {
    module: `${baseRealmPrefix}markdown-file-def`,
    name: 'MarkdownDef',
  },
  '.md': {
    module: `${baseRealmPrefix}markdown-file-def`,
    name: 'MarkdownDef',
  },
  '.png': {
    module: `${baseRealmPrefix}png-image-def`,
    name: 'PngDef',
  },
  '.jpg': {
    module: `${baseRealmPrefix}jpg-image-def`,
    name: 'JpgDef',
  },
  '.jpeg': {
    module: `${baseRealmPrefix}jpg-image-def`,
    name: 'JpgDef',
  },
  '.svg': {
    module: `${baseRealmPrefix}svg-image-def`,
    name: 'SvgDef',
  },
  '.gif': {
    module: `${baseRealmPrefix}gif-image-def`,
    name: 'GifDef',
  },
  '.webp': {
    module: `${baseRealmPrefix}webp-image-def`,
    name: 'WebpDef',
  },
  '.avif': {
    module: `${baseRealmPrefix}avif-image-def`,
    name: 'AvifDef',
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
  if (mapping.module.includes('://') || mapping.module.startsWith('@')) {
    return mapping;
  }
  return {
    ...mapping,
    module: resolveCardReference(mapping.module, fileURL),
  };
}
