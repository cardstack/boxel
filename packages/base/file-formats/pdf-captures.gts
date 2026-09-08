// The PDF family's declared-screenshot capture: a capture-only component
// that paints page 1 with pdf.js so the fitted cell (and the thumbnail
// fallback chain) get a real first page instead of the typed placeholder.
// Capture-only means: referenced only from the `static screenshots`
// declaration and rendered only by the screenshot render route during the
// prerender pass — never part of the format API, so the live viewer stays a
// native `<object>` with no pdf.js in the app's dependency graph.
//
// pdf.js loads from a pinned CDN build at capture time — via the browser's
// native module loader, not the Boxel loader (see `loadPdfjs`). The decoder
// is needed only inside the capture render, and vendoring a PDF engine into
// the base realm would tax every consumer for a poster only the prerender
// pass draws. Unlike the 3D family's live-render CDN loading, this fetch
// happens on prerender infrastructure: CDN reachability from the prerender's
// network is a standing requirement of this slot, and an unreachable CDN
// surfaces as a bounded slot failure (retry-lane capped), never a blank
// poster.
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';

import { fileResourceURL } from './file-image';

import type { ScreenshotSpec } from '../card-api';

interface CaptureSignature {
  Args: {
    model: any;
  };
  Element: HTMLElement;
}

// pdf.js loads through the browser's own module loader, deliberately
// outside the Boxel loader: transpiled card code's `import()` is rewritten
// into the loader's fetch-and-transpile pipeline, and pushing a
// megabyte-scale engine through in-browser transpilation inside the
// capture's bounded readiness window is a capture failure, not a load. The
// indirection through `Function` is what keeps the transpiler's rewrite off
// this one call; the browser fetches the pinned CORS-enabled ESM build
// directly and caches it for the life of the pooled tab.
const importNative = new Function('s', 'return import(s)') as (
  s: string,
) => Promise<any>;

// Memoized so concurrent captures on one tab share a single load.
let pdfjsPromise: Promise<any> | undefined;

function loadPdfjs(): Promise<any> {
  pdfjsPromise ??= importNative(
    'https://esm.sh/pdfjs-dist@4.10.38/legacy/build/pdf.mjs',
  ).then((pdfjs: any) => {
    // Cross-origin `Worker` construction is blocked by the browser, so
    // pdf.js falls back to loading this same URL as a module on the main
    // thread (its "fake worker" path) — main-thread rasterization is the
    // intended mode for a capture render, not an accident.
    pdfjs.GlobalWorkerOptions.workerSrc =
      'https://esm.sh/pdfjs-dist@4.10.38/legacy/build/pdf.worker.mjs';
    return pdfjs;
  });
  return pdfjsPromise;
}

export class PdfPosterCapture extends GlimmerComponent<CaptureSignature> {
  // The capture engine waits (bounded) for no `data-screenshot-pending`
  // attribute before shooting: an async decode's paint isn't visible to the
  // engine's image-paint wait, so the component owns the readiness signal.
  @tracked pending = true;

  private paintFirstPage = modifier((canvas: HTMLCanvasElement) => {
    let cancelled = false;
    let finish = () => {
      if (!cancelled) {
        this.pending = false;
      }
    };
    (async () => {
      // Hoisted so the finally can release it: capture renders are route
      // transitions on a pooled warm tab — one long-lived JS heap across
      // many captures — so an undestroyed document accumulates until the
      // tab recycles.
      let doc: any;
      try {
        let url = fileResourceURL(this.args.model);
        if (!url) {
          return;
        }
        let pdfjs: any = await loadPdfjs();
        let response = await fetch(url);
        if (!response.ok) {
          return;
        }
        let data = new Uint8Array(await response.arrayBuffer());
        doc = await pdfjs.getDocument({ data, isEvalSupported: false })
          .promise;
        let page = await doc.getPage(1);
        if (cancelled) {
          return;
        }
        // Contain page 1 in the declared box at the capture's device scale,
        // so the rasterized text stays sharp at the physical pixel size.
        let box = canvas.parentElement!.getBoundingClientRect();
        let scale = window.devicePixelRatio || 1;
        let base = page.getViewport({ scale: 1 });
        let fit = Math.min(
          (box.width * scale) / base.width,
          (box.height * scale) / base.height,
        );
        let viewport = page.getViewport({ scale: fit });
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        canvas.style.width = `${Math.round(viewport.width / scale)}px`;
        canvas.style.height = `${Math.round(viewport.height / scale)}px`;
        await page.render({
          canvasContext: canvas.getContext('2d'),
          viewport,
        }).promise;
        // Readiness resolves only on a painted page. A corrupt or
        // unreadable document leaves `data-screenshot-pending` standing, so
        // the engine's bounded wait fails this slot: no manifest entry
        // lands, the fitted cell keeps the typed page placeholder, and the
        // retry lane's failure cap bounds what a permanently unreadable
        // file can cost. Resolving on failure would persist a blank white
        // poster (the slot's default background) that the thumbnail seam
        // would prefer over the placeholder.
        finish();
      } catch {
        // Intentionally not resolving readiness — see the comment above
        // `finish()`.
      } finally {
        try {
          await doc?.destroy?.();
        } catch {
          // Releasing a torn-down document must never mask the capture
          // outcome.
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  });

  <template>
    <div
      class='pdf-poster-capture'
      data-screenshot-pending={{if this.pending 'true'}}
    >
      <canvas {{this.paintFirstPage}} />
    </div>
    <style scoped>
      /* Fill the capture box; the page canvas centers at its own aspect on
         the white page ground the slot's background provides. */
      .pdf-poster-capture {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        overflow: hidden;
      }
    </style>
  </template>
}

// The PDF family's declared roster: one `poster` at the recommended
// thumbnail box (the CardsGrid tile, 170×250 at the default
// deviceScaleFactor of 2), keyed on file content so a metadata-only edit
// never re-rasterizes, feeding the thumbnail fallback chain and — through
// the view model's thumbnail seam — the fitted cell.
export const PDF_FAMILY_SCREENSHOTS: Record<string, ScreenshotSpec> = {
  poster: {
    render: PdfPosterCapture,
    width: 170,
    height: 250,
    keyBy: 'file-content',
    useAsThumbnail: true,
  },
};
