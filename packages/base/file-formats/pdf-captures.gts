// The PDF family's declared-screenshot capture: a capture-only component
// that paints page 1 with pdf.js so the fitted cell (and the thumbnail
// fallback chain) get a real first page instead of the typed placeholder.
// Capture-only means: referenced only from the `static screenshots`
// declaration and rendered only by the screenshot render route during the
// prerender pass — never part of the format API, so the live viewer stays a
// native `<object>` with no pdf.js in the app's dependency graph.
//
// pdf.js is the host's vendored copy (not a CDN fetch inside the render:
// this capture runs on prerender infrastructure, where public-network
// reachability would otherwise be a standing availability dependency of
// every realm that holds a PDF), reached through `loadPdfjs` below. The
// engine's chunk loads only when that function is called at capture time,
// so consumers of the family that never capture — the live viewer's native
// `<object>` path included — never pay for it.
import GlimmerComponent from '@glimmer/component';
import { modifier } from 'ember-modifier';

import { fileResourceURL } from './file-image';
// The host's vendored pdf.js, behind a statically-imported sync shim whose
// function performs the host-side lazy chunk load — a runtime `import()` of
// a shimmed bare specifier is not a load path card code can rely on (the
// loader resolves shims for static imports; the dynamic form stalls), while
// a static import of this zero-cost function keeps the engine's chunk load
// at the call. The wrapper behind it wires a same-origin worker asset, so
// rasterization runs on a real worker rather than pdf.js's main-thread
// fallback. `@cardstack/boxel-host/lib/*` is the card-facing doorway for
// host library modules, the same spelling family as the
// `@cardstack/boxel-host/tools/*` shims.
import { loadPdfjs } from '@cardstack/boxel-host/lib/pdfjs-loader';

import type { ScreenshotSpec } from '../card-api';

interface CaptureSignature {
  Args: {
    model: any;
  };
  Element: HTMLElement;
}

export class PdfPosterCapture extends GlimmerComponent<CaptureSignature> {
  // The capture engine waits (bounded) for no `data-screenshot-pending`
  // attribute before shooting: an async decode's paint isn't visible to the
  // engine's image-paint wait, so the component owns the readiness signal.
  //
  // Both signals are written by mutating the attribute directly, not by a
  // tracked re-render: the capture page is settled when the engine starts
  // waiting, and a tracked update from this modifier's async continuation
  // demonstrably never flushed there (the paint completed in under a
  // second; the attribute still read pending at the engine's full timeout).
  // The engine polls raw DOM, so raw DOM is the reliable channel.
  private paintFirstPage = modifier((canvas: HTMLCanvasElement) => {
    let cancelled = false;
    let container = canvas.parentElement!;
    let finish = () => {
      if (!cancelled) {
        container.removeAttribute('data-screenshot-pending');
      }
    };
    // A document that cannot decode (corrupt, encrypted, password-protected
    // — an ordinary case, not a corner) will never become ready: swap in the
    // definitive-failure signal so the engine fails this slot immediately
    // instead of holding the prerender lane for the full pending budget on
    // every retry. Failing the slot is the point — no manifest entry lands
    // (the injected durable URL stays an uncaptured 404 the fitted cell's
    // image fallback absorbs). Resolving readiness instead would persist a
    // blank white poster (the slot's default background) that the thumbnail
    // seam would serve as if it were the real page. The attribute value
    // carries the cause into the slot's failure diagnostics, so an
    // unreadable document is distinguishable from a hung component.
    let fail = (cause: unknown) => {
      if (!cancelled) {
        container.removeAttribute('data-screenshot-pending');
        container.setAttribute('data-screenshot-failed', String(cause));
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
          fail('no file resource url on the model');
          return;
        }
        let pdfjs: any = await loadPdfjs();
        let response = await fetch(url);
        if (!response.ok) {
          fail(`fetching the document returned ${response.status}`);
          return;
        }
        let data = new Uint8Array(await response.arrayBuffer());
        doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
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
        // Readiness resolves only on a painted page; every failure path
        // resolves the definitive-failure signal instead — see the comment
        // above `fail()`.
        finish();
      } catch (error) {
        fail(error);
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
    <div class='pdf-poster-capture' data-screenshot-pending='true'>
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
