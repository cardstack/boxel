// Pretui — MediaViewer: one entry point for any asset, routed to the adapter that claims its kind.
//
//   <MediaViewer @asset={{asset}} />
//     ├─ video → VideoPlayer
//     ├─ audio → AudioPlayer
//     ├─ image → ImageFrame
//     └─ anything else → an honest, named fallback
//
// The point of this file is NOT the two players it happens to route to. It
// is that kind detection and adapter selection live HERE, once, so that the
// next kind — model, PDF, SVG, font, CAD — is a registration rather than a
// rewrite, and no caller ever has to know what it is holding.
//
// Three decisions worth stating, because they are what make it an adapter
// shell rather than a switch statement:
//
//   1. **Kind detection is data, in one place.** An explicit `kind` wins;
//      then the MIME type (including the one inside a `data:` URL); then the
//      extension, through a table. A caller never sniffs.
//   2. **The registry is open and last-write-wins.** `registerMediaAdapter`
//      unshifts, so a consumer that registers `image` after this module
//      loads overrides the built-in without patching it. Adapters are
//      matched by predicate, not by kind, so an adapter can claim a subset
//      ("images under 2 MP", "audio with a transcript").
//   3. **The fallback names the gap.** An unrouted asset does not render a
//      blank box; it renders what kind it is, what would handle it, and a
//      link to open the file when that link is safe. A kind with no adapter
//      registered says so out loud rather than failing silently.
//
// BETTER THAN THE INSPIRATION: every DAM viewer surveyed picks its viewer
// with an if-chain inside the gallery component, which is why adding a kind
// means editing the gallery. Here the gallery knows nothing.
import Component from '@glimmer/component';
import { EmptyState } from './empty-state';
import { adapterFor, resolveAsset, safeHref } from '../internal/media-viewer';
import type { MediaAdapter, MediaAssetSpec, ResolvedMediaAsset } from '../internal/media-viewer';

// What the fallback says it is waiting for. Naming the intended component
// is Law 7's "unfinished edges are named in the docs rather than hidden",
// moved from the docs into the UI where it is actually read.
const PLANNED: Readonly<Record<string, string>> = {
  model: 'ModelViewer, on @google/model-viewer — not vendored yet.',
  unknown: 'No adapter claims this kind.',
};

// ── MediaViewer ──────────────────────────────────────────────────────────

export interface MediaViewerSignature {
  Args: {
    /** The asset to show. Kind detection happens here. */
    asset: MediaAssetSpec;
  };
  Blocks: {
    /** Replaces the built-in fallback for an unrouted asset. */
    unsupported: [];
  };
  Element: HTMLDivElement;
}

export class MediaViewer extends Component<MediaViewerSignature> {
  get asset(): ResolvedMediaAsset {
    return resolveAsset(this.args.asset);
  }
  get adapter(): MediaAdapter | undefined {
    return adapterFor(this.asset);
  }
  get adapterId(): string {
    return this.adapter?.id ?? 'unsupported';
  }
  get fallbackTitle(): string {
    return `Nothing here opens ${this.asset.kind === 'unknown' ? 'this file' : `${this.asset.kind} assets`} yet`;
  }
  get openHref(): string | undefined {
    return safeHref(this.asset.src);
  }
  get fallbackMessage(): string {
    return (
      PLANNED[this.asset.kind] ??
      'No adapter claims this kind. Register one with registerMediaAdapter.'
    );
  }

  <template>
    <div
      class='pretui-mviewer'
      data-adapter={{this.adapterId}}
      data-kind={{this.asset.kind}}
      data-test-pretui-media-viewer
      ...attributes
    >
      {{#if this.adapter}}
        {{#let this.adapter.component as |Adapter|}}
          <Adapter @asset={{this.asset}} />
        {{/let}}
      {{else if (has-block 'unsupported')}}
        {{yield to='unsupported'}}
      {{else}}
        <EmptyState @title={{this.fallbackTitle}} @texture={{false}}>
          <:default>
            {{this.fallbackMessage}}
          </:default>
          <:action>
            {{#if this.openHref}}
              <a
                class='pretui-mviewer-link'
                href={{this.openHref}}
                target='_blank'
                rel='noopener noreferrer'
              >Open {{this.asset.label}} in a new tab</a>
            {{/if}}
          </:action>
        </EmptyState>
      {{/if}}
    </div>

    <style scoped>
      @layer PretComponent {
        .pretui-mviewer {
          display: block;
          min-width: 0;
        }
        .pretui-mviewer-link {
          font-size: var(--text-ui-sm, 11.5px);
          font-weight: 600;
          color: var(--pretui-primary-ink, var(--boxel-highlight-hover));
          text-underline-offset: 3px;
        }
        .pretui-mviewer-link:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 3px;
          border-radius: 3px;
        }
      }
    </style>
  </template>
}
