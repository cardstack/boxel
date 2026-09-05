// The PDF family's declared-screenshot capture: a capture-only component
// that paints page 1 with pdf.js so the fitted cell (and the thumbnail
// fallback chain) get a real first page instead of the typed placeholder.
// Capture-only means: referenced only from the `static screenshots`
// declaration and rendered only by the screenshot render route during the
// prerender pass — never part of the format API, so the live viewer stays a
// native `<object>` with no pdf.js in the app's dependency graph.
//
// pdf.js loads from a pinned CDN build at capture time, the same delivery
// the 3D family uses for three.js: the decoder is needed only inside the
// capture render, and vendoring a PDF engine into the base realm would tax
// every consumer for a poster only the prerender pass draws.
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
      try {
        let url = fileResourceURL(this.args.model);
        if (!url) {
          return;
        }
        let pdfjs: any =
          // @ts-expect-error Pinned browser ESM import; the Boxel loader resolves https:// at runtime
          await import('https://esm.sh/pdfjs-dist@4.10.38/legacy/build/pdf.mjs');
        pdfjs.GlobalWorkerOptions.workerSrc =
          'https://esm.sh/pdfjs-dist@4.10.38/legacy/build/pdf.worker.mjs';
        let response = await fetch(url);
        if (!response.ok) {
          return;
        }
        let data = new Uint8Array(await response.arrayBuffer());
        let doc = await pdfjs.getDocument({ data, isEvalSupported: false })
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
      } catch {
        // A corrupt or unreadable document is an absent poster, not a broken
        // capture render: readiness still resolves, the engine shoots the
        // empty page, and byte-hash dedupe keeps the blank from churning.
      } finally {
        finish();
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
