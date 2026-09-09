// The PDF family's renderer, projected into the four format shells by
// `FilePreviewStage`. The browser is the reader: embedded and isolated mount the
// document in a native `<object>` viewer (scrolling, selection, and search come
// for free), while the budgeted fitted cell shows a lightweight page placeholder
// rather than a live PDF engine per tile.
//
// The fitted first-page poster is deliberately not drawn here: the family's
// declared `poster` capture (see `pdf-captures`) rasterizes page 1 during the
// prerender pass, and the preview stage prefers that rendition over this
// placeholder through the view model's `thumbnailUrl` — the placeholder is
// the graceful fallback for an uncaptured or capture-errored document.
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';

import { LoadingIndicator } from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';

import { FileObject } from './file-resources';
import type { FilePreviewSignature } from './file-preview-stage';

// Base cards read this global to tell a server-side prerender from a live
// client render (same signal `query-field-support` and the 3D family use).
function isLiveRender(): boolean {
  return !(globalThis as { __boxelRenderContext?: unknown })
    .__boxelRenderContext;
}

// One live fetch's outcome, remembered with the URL it belongs to so a
// model swap can never serve a stale document: the getters below ignore any
// entry whose `forUrl` no longer matches, which also lets the modifier's
// cleanup skip tracked writes entirely (a stale blob is simply never read).
interface LoadedDocument {
  forUrl: string;
  blobUrl: string | undefined;
}

// Upper bound on the live document fetch. Generous, because a large
// document on a slow link is the ordinary case a reader still wants to win;
// bounded, because a stalled fetch must eventually yield to the plain-URL
// fallback rather than holding the loading state forever.
const DOCUMENT_FETCH_TIMEOUT_MS = 30_000;

export class PdfViewer extends GlimmerComponent<FilePreviewSignature> {
  // The served document URL. `<object>`/`<embed>` loads bypass service
  // workers (per the ServiceWorker spec), so no Authorization header can be
  // attached to the object's own fetch — a plain URL renders only when the
  // realm is publicly readable. In a live render the document is therefore
  // fetched here in the component (the host auth service worker injects the
  // realm Authorization header on this GET, the same path that lets
  // `<img src>` load realm images) and handed to the `<object>` as a
  // same-document blob URL; the plain URL remains the fallback when that
  // fetch fails (an anonymous visitor on a public realm has no session to
  // inject, and the plain URL works there). Prerender keeps the plain URL
  // with no fetch: the snapshot needs the markup, not the bytes. The
  // realm's content negotiation keys off the request's Sec-Fetch-Dest to
  // serve the file's bytes to an `<object>` rather than the host app shell.
  get resourceUrl(): string {
    return this.args.model?.resourceUrl ?? this.args.model?.url ?? '';
  }

  @tracked private loaded: LoadedDocument | undefined;

  // Loading = a live fetch for the current URL has not settled yet. The
  // `<object>` is withheld until then so a private realm never flashes the
  // plugin's error page for the unauthenticated plain-URL load it would
  // otherwise start immediately; a spinner holds the space so a slow fetch
  // reads as loading rather than broken, and the fetch's own timeout bounds
  // how long this state can last.
  private get isLoading(): boolean {
    return (
      isLiveRender() &&
      !!this.resourceUrl &&
      this.loaded?.forUrl !== this.resourceUrl
    );
  }

  private get objectUrl(): string {
    let { loaded } = this;
    return loaded?.forUrl === this.resourceUrl && loaded.blobUrl
      ? loaded.blobUrl
      : this.resourceUrl;
  }

  // Lives on the wrapper that survives the loading→loaded swap, so state
  // flips never re-run it; it re-runs only when the document URL changes.
  private loadDocument = modifier((_element: HTMLElement, [url]: [string]) => {
    if (!url || !isLiveRender()) {
      return;
    }
    let cancelled = false;
    let controller = new AbortController();
    // A stalled fetch aborts here with `cancelled` still false, so the
    // settle below runs with no blob and the plain URL takes over — the
    // same fallback a failed fetch gets.
    let timeout = setTimeout(
      () => controller.abort(),
      DOCUMENT_FETCH_TIMEOUT_MS,
    );
    let createdBlobUrl: string | undefined;
    void (async () => {
      let blobUrl: string | undefined;
      try {
        // No `credentials: 'include'` — that makes a credentialed CORS
        // request, illegal against the realm's wildcard
        // `Access-Control-Allow-Origin`. The host auth service worker
        // injects the realm `Authorization` header on this GET.
        let response = await fetch(url, { signal: controller.signal });
        if (response.ok) {
          let bytes = await response.arrayBuffer();
          if (cancelled) {
            return;
          }
          createdBlobUrl = URL.createObjectURL(
            new Blob([bytes], { type: 'application/pdf' }),
          );
          blobUrl = createdBlobUrl;
        }
      } catch {
        // Fall through: `blobUrl` stays undefined and the plain URL serves
        // as the fallback (the public-realm anonymous case, or a timed-out
        // fetch).
      } finally {
        clearTimeout(timeout);
      }
      if (!cancelled) {
        this.loaded = { forUrl: url, blobUrl };
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      controller.abort();
      if (createdBlobUrl) {
        // The object element for this URL is going away with us (teardown or
        // URL change re-rendering it), so its backing blob can be released.
        URL.revokeObjectURL(createdBlobUrl);
      }
    };
  });

  get pageCount(): number | undefined {
    return this.args.model?.documentInfo?.pageCount;
  }

  get title(): string {
    return (
      this.args.model?.documentInfo?.title ||
      this.args.model?.baseName ||
      this.args.model?.name ||
      'PDF document'
    );
  }

  <template>
    {{#if (eq @format 'fitted')}}
      <div class='pdf-fitted' data-test-pdf-fitted>
        <div class='page-mock'>
          <span class='page-badge'>PDF</span>
          {{#if this.pageCount}}
            <span class='page-count'>{{this.pageCount}}
              {{if (eq this.pageCount 1) 'page' 'pages'}}</span>
          {{/if}}
        </div>
      </div>
    {{else}}
      <div class='pdf-frame' {{this.loadDocument this.resourceUrl}}>
        {{#if this.isLoading}}
          <div class='pdf-loading' data-test-pdf-loading>
            <LoadingIndicator />
          </div>
        {{else}}
          <FileObject
            class='pdf-object'
            @url={{this.objectUrl}}
            @type='application/pdf'
            @label={{this.title}}
            data-test-pdf-viewer
          />
        {{/if}}
      </div>
    {{/if}}

    <style scoped>
      /* Embedded/isolated: the native viewer fills the space the shell hands it
         and owns its own scrolling. The frame paints the same stage ground
         while the authed document fetch is in flight. */
      .pdf-frame {
        width: 100%;
        height: 100%;
        min-height: 0;
        background: var(--fd-stage, var(--muted, #eceef1));
      }
      .pdf-object {
        display: block;
        width: 100%;
        height: 100%;
        min-height: 0;
        border: 0;
        background: var(--fd-stage, var(--muted, #eceef1));
      }
      .pdf-loading {
        display: grid;
        place-items: center;
        width: 100%;
        height: 100%;
      }

      /* Fitted: a page-shaped placeholder, not a PDF engine. It reads as "a
         document, N pages" until the poster contract renders a real first page. */
      .pdf-fitted {
        width: 100%;
        height: 100%;
        display: grid;
        place-items: center;
        padding: 10px;
        background: var(--fd-stage, var(--muted, #eceef1));
        container-type: inline-size;
      }
      .page-mock {
        position: relative;
        width: min(72%, 8rem);
        aspect-ratio: 3 / 4;
        background: var(--card, #fff);
        border: 1px solid var(--border);
        border-radius: 3px;
        box-shadow: 0 1px 4px rgb(0 0 0 / 12%);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 6px;
      }
      /* The ruled lines that read as "page of text" behind the label. */
      .page-mock::before {
        content: '';
        position: absolute;
        inset: 14% 16%;
        background-image: repeating-linear-gradient(
          var(--border) 0 1px,
          transparent 1px 9px
        );
        opacity: 0.5;
      }
      .page-badge {
        position: relative;
        font-family: var(--font-mono);
        font-size: 0.6875rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        color: var(--fd-paper, var(--card, #f7f7f5));
        background: var(--fd-slate, var(--foreground));
        padding: 2px 8px;
        border-radius: 3px;
      }
      .page-count {
        position: relative;
        font-family: var(--font-mono);
        font-size: 0.5625rem;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--muted-foreground);
      }
    </style>
  </template>
}
