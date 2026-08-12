// The image resource primitive, alone in its own module because it sits in
// card-api's universal dependency graph: ImageDef's preview renderer reaches
// it through `image-preview`, so every card in every realm loads this file.
// The heavier media primitives (audio/video transports, the font loader) stay
// in `file-resources`, which re-exports these names so the public surface is
// unchanged.
import GlimmerComponent from '@glimmer/component';

// A structural contract rather than `FileDef` itself, so callers can pass a
// plain object (a test fixture, a serialized file) as well as a real instance.
export interface FileResourceLike {
  id?: string | URL | null;
  url?: string | URL | null;
  sourceUrl?: string | URL | null;
  name?: string | null;
  contentType?: string | null;
}

export function stringValue(value?: string | URL | null): string {
  return value == null ? '' : String(value);
}

// One precedence order for every primitive: an explicit URL wins, then the
// FileDef's own `url`, then its id, then the source URL it was extracted from.
export function fileResourceURL(
  file?: FileResourceLike | null,
  explicitURL?: string | URL | null,
): string {
  return (
    stringValue(explicitURL) ||
    stringValue(file?.url) ||
    stringValue(file?.id) ||
    stringValue(file?.sourceUrl)
  );
}

interface FileImageSignature {
  Args: {
    file?: FileResourceLike | null;
    url?: string | URL | null;
    name?: string | null;
    src?: string | URL | null;
    alt?: string | null;
    loading?: 'eager' | 'lazy';
    decoding?: 'async' | 'auto' | 'sync';
  };
  Element: HTMLImageElement;
}

// Exactly one `<img>`; the caller owns every visual decision through
// `...attributes`.
export class FileImage extends GlimmerComponent<FileImageSignature> {
  get src() {
    return fileResourceURL(this.args.file, this.args.src ?? this.args.url);
  }
  get alt() {
    return this.args.alt ?? this.args.name ?? this.args.file?.name ?? '';
  }

  <template>
    {{#if this.src}}
      <img
        src={{this.src}}
        alt={{this.alt}}
        loading={{@loading}}
        decoding={{@decoding}}
        ...attributes
      />
    {{/if}}
  </template>
}
