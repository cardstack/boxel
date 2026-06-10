import {
  isCssResource,
  isIdentityOnlyCardResource,
  isRenderedHtmlResource,
  type CodeRef,
} from '@cardstack/runtime-common';

import type {
  UnifiedSearchCollectionDocument,
  UnifiedSearchIncludedResource,
} from '@cardstack/runtime-common/document-types';

import { htmlComponent, type HTMLComponent } from './html-component.ts';

// One row of a unified search response, reduced to what the search UI renders.
// An HTML-backed (identity-only) row carries an inert `component` built from its
// `rendered-html`; a full live row carries no component — the caller renders
// its Store-resident card live (under `renderType`).
export interface RenderableSearchItem {
  id: string;
  // The collection's resolved render type, so a live/fallback row renders as
  // the same ancestor type as its HTML siblings.
  renderType: CodeRef | undefined;
  // The inert prerendered component, present only for HTML-backed rows.
  component: HTMLComponent | undefined;
  isError: boolean;
}

function identityKey(type: string, id: string): string {
  // A local index over the JSON:API `(type, id)` identity. A space separates
  // them safely: the resource types here (card / rendered-html / css /
  // file-meta) and their ids (URLs, content hashes) never contain a space.
  return `${type} ${id}`;
}

// Read a unified search document into renderable rows. Per the resolution
// policy each row is either an identity-only `card` backed by a `rendered-html`
// (rendered inert from its HTML, with its scoped `css` imported) or a full live
// `card`/`file-meta` (rendered live by the caller from the Store). `importCss`
// is injected so this stays pure/testable; callers pass the loader's import.
export async function buildRenderableSearchItems(
  doc: UnifiedSearchCollectionDocument,
  importCss: (href: string) => Promise<unknown>,
): Promise<RenderableSearchItem[]> {
  let includedByIdentity = new Map<string, UnifiedSearchIncludedResource>();
  for (let resource of doc.included ?? []) {
    if (resource.id != null) {
      includedByIdentity.set(identityKey(resource.type, resource.id), resource);
    }
  }

  let renderType = doc.meta.renderType;
  // Deduped so a stylesheet shared across rows imports once.
  let cssHrefs = new Set<string>();
  let items: RenderableSearchItem[] = [];

  for (let resource of doc.data) {
    let id = resource.id;
    if (!id) {
      continue;
    }

    if (!isIdentityOnlyCardResource(resource)) {
      // Full live card / file-meta — rendered from its Store-resident instance.
      items.push({ id, renderType, component: undefined, isError: false });
      continue;
    }

    let renderedRef = resource.relationships?.['rendered-html']?.data as
      | { type: string; id: string }
      | undefined;
    let rendered = renderedRef
      ? includedByIdentity.get(identityKey('rendered-html', renderedRef.id))
      : undefined;
    if (!rendered || !isRenderedHtmlResource(rendered)) {
      // Identity-only with no resolvable rendered-html: surface the row with no
      // component so the caller can fall back rather than render nothing.
      items.push({ id, renderType, component: undefined, isError: false });
      continue;
    }

    for (let cssRef of rendered.relationships.styles.data) {
      let css = includedByIdentity.get(identityKey('css', cssRef.id));
      if (css && isCssResource(css)) {
        cssHrefs.add(css.attributes.href);
      }
    }

    // Stamp the type display-name / icon so the existing search adornments
    // (which read these data attributes off the rendered element) keep working.
    let component = htmlComponent(rendered.attributes.html, {
      'data-card-type-display-name': rendered.attributes.cardType,
      ...(rendered.attributes.iconHtml
        ? { 'data-card-type-icon-html': rendered.attributes.iconHtml }
        : {}),
    });
    items.push({
      id,
      renderType,
      component,
      isError: rendered.attributes.isError === true,
    });
  }

  // The inert HTML references its scoped CSS by URL; importing each makes the
  // stylesheet available (replacing the legacy `meta.scopedCssUrls` loop).
  await Promise.all([...cssHrefs].map((href) => importCss(href)));

  return items;
}
