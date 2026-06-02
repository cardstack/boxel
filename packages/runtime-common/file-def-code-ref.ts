import { baseRealm, baseFileRef } from './constants';
import type { ResolvedCodeRef } from './code-ref';
import type { RealmResourceIdentifier } from './card-reference-resolver';
import type { VirtualNetwork } from './virtual-network';

export const BASE_FILE_DEF_CODE_REF = baseFileRef;

function baseModule(name: string): RealmResourceIdentifier {
  return `${baseRealm.url}${name}` as RealmResourceIdentifier;
}

const FILEDEF_CODE_REF_BY_EXTENSION: Record<string, ResolvedCodeRef> = {
  // TODO: Replace with realm metadata configuration.
  '.markdown': { module: baseModule('markdown-file-def'), name: 'MarkdownDef' },
  '.md': { module: baseModule('markdown-file-def'), name: 'MarkdownDef' },
  '.png': { module: baseModule('png-image-def'), name: 'PngDef' },
  '.jpg': { module: baseModule('jpg-image-def'), name: 'JpgDef' },
  '.jpeg': { module: baseModule('jpg-image-def'), name: 'JpgDef' },
  '.svg': { module: baseModule('svg-image-def'), name: 'SvgDef' },
  '.gif': { module: baseModule('gif-image-def'), name: 'GifDef' },
  '.webp': { module: baseModule('webp-image-def'), name: 'WebpDef' },
  '.avif': { module: baseModule('avif-image-def'), name: 'AvifDef' },
  '.ts': { module: baseModule('ts-file-def'), name: 'TsFileDef' },
  '.gts': { module: baseModule('gts-file-def'), name: 'GtsFileDef' },
  '.txt': { module: baseModule('text-file-def'), name: 'TextFileDef' },
  '.text': { module: baseModule('text-file-def'), name: 'TextFileDef' },
  '.json': { module: baseModule('json-file-def'), name: 'JsonFileDef' },
  '.csv': { module: baseModule('csv-file-def'), name: 'CsvFileDef' },
  '.mp3': { module: baseModule('mp3-audio-def'), name: 'Mp3Def' },
  '.wav': { module: baseModule('wav-audio-def'), name: 'WavDef' },
  '.ogg': { module: baseModule('ogg-audio-def'), name: 'OggDef' },
  '.oga': { module: baseModule('ogg-audio-def'), name: 'OggDef' },
  '.opus': { module: baseModule('ogg-audio-def'), name: 'OggDef' },
  '.m4a': { module: baseModule('m4a-audio-def'), name: 'M4aDef' },
  '.flac': { module: baseModule('flac-audio-def'), name: 'FlacDef' },
  '.mismatch': {
    module: './filedef-mismatch' as RealmResourceIdentifier,
    name: 'FileDef',
  },
};

export function resolveFileDefCodeRef(
  fileURL: URL,
  virtualNetwork: VirtualNetwork,
): ResolvedCodeRef {
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
    module: virtualNetwork.resolveURL(mapping.module, fileURL)
      .href as RealmResourceIdentifier,
  };
}
