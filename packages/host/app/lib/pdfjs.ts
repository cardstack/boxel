// The host's pdf.js surface, served to card code through the virtual
// network's async shim (see `externals.ts`). Vendoring the engine here —
// rather than fetching a CDN build inside the capture render — keeps realm
// indexing off the public network: the poster capture runs on prerender
// infrastructure, where CDN reachability would otherwise be a standing
// availability dependency of every realm that holds a PDF.
//
// This module is imported only through the shim's lazy `resolve`, so pdf.js
// stays out of the host's initial chunk graph; the bundle chunk loads the
// first time a consumer (in practice, the PDF family's capture-only
// component) asks for it.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
// Vite emits the worker as a same-origin asset, so pdf.js can construct a
// real `Worker` from it — a cross-origin worker URL is refused by the
// browser and silently downgrades pdf.js to main-thread rasterization.
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export default pdfjs;
export * from 'pdfjs-dist/legacy/build/pdf.mjs';
