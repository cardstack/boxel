import {
  CardDef,
  Component,
  field,
  contains,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import FileDef from 'https://cardstack.com/base/file-api';
import { Button } from '@cardstack/boxel-ui/components';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import { task } from 'ember-concurrency';
import FileTextIcon from '@cardstack/boxel-icons/file-text';

interface NormalizedBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PdfHighlight {
  id: string;
  type: 'highlight';
  pageNumber: number;
  text: string;
  color: string;
  bounds: NormalizedBounds[];
}

const pdfCanvas = modifier(
  (element: HTMLCanvasElement, [component]: [PdfAnnotationIsolated]) => {
    component.canvas = element;
    component.loadPdf.perform();

    return () => {
      component.canvas = null;
    };
  },
);

class PdfAnnotationIsolated extends Component<typeof PdfAnnotationCard> {
  @tracked pageNumber = this.args.model.pageNumber || 1;
  @tracked totalPages = 0;
  @tracked errorMessage = '';

  canvas: HTMLCanvasElement | null = null;
  private pdfDoc: any;

  get pdfUrl() {
    return this.args.model.pdfFile?.url;
  }

  get highlights(): PdfHighlight[] {
    if (!this.args.model.annotationData) return [];

    try {
      return JSON.parse(this.args.model.annotationData) as PdfHighlight[];
    } catch {
      return [];
    }
  }

  private saveHighlights(highlights: PdfHighlight[]) {
    this.args.model.annotationData = JSON.stringify(highlights);
  }

  private async ensurePdfJs() {
    if (!(globalThis as any).pdfjsLib) {
      await this.loadScript(
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
      );

      (globalThis as any).pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }

    if (!document.querySelector('link[href*="pdf_viewer.css"]')) {
      await this.loadCss(
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf_viewer.css',
      );
    }
  }

  private loadScript(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let script = document.createElement('script');
      script.src = src;
      script.onload = () => resolve();
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  private loadCss(href: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.onload = () => resolve();
      link.onerror = reject;
      document.head.appendChild(link);
    });
  }

  loadPdf = task(async () => {
    if (!this.pdfUrl || !this.canvas) return;

    try {
      await this.ensurePdfJs();
      let pdfjsLib = (globalThis as any).pdfjsLib;
      this.pdfDoc = await pdfjsLib.getDocument(this.pdfUrl).promise;
      this.totalPages = this.pdfDoc.numPages;
      this.pageNumber = Math.min(
        Math.max(this.pageNumber, 1),
        this.totalPages,
      );
      await this.renderPage.perform(this.pageNumber);
      this.errorMessage = '';
    } catch (error: any) {
      this.errorMessage = error?.message || 'Unable to load PDF';
    }
  });

  renderPage = task(async (pageNumber: number) => {
    if (!this.pdfDoc || !this.canvas) return;

    let page = await this.pdfDoc.getPage(pageNumber);
    let baseViewport = page.getViewport({ scale: 1 });
    let wrapper = this.canvas.parentElement as HTMLElement;
    let scale = Math.min(1.5, wrapper.clientWidth / baseViewport.width);
    let viewport = page.getViewport({ scale });
    let outputScale = window.devicePixelRatio || 1;
    let context = this.canvas.getContext('2d');
    if (!context) return;

    this.canvas.width = Math.floor(viewport.width * outputScale);
    this.canvas.height = Math.floor(viewport.height * outputScale);
    this.canvas.style.width = `${Math.floor(viewport.width)}px`;
    this.canvas.style.height = `${Math.floor(viewport.height)}px`;
    wrapper.style.width = this.canvas.style.width;
    wrapper.style.height = this.canvas.style.height;

    let transform =
      outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0];

    await page.render({ canvasContext: context, viewport, transform }).promise;
    await this.createTextLayer(page, viewport);
    this.renderHighlights();

    this.pageNumber = pageNumber;
    this.args.model.pageNumber = pageNumber;
  });

  private async createTextLayer(page: any, viewport: any) {
    if (!this.canvas?.parentElement) return;

    let wrapper = this.canvas.parentElement;
    wrapper.querySelector('.textLayer')?.remove();

    let layer = document.createElement('div');
    layer.className = 'textLayer';
    Object.assign(layer.style, {
      position: 'absolute',
      inset: '0',
      width: `${Math.floor(viewport.width)}px`,
      height: `${Math.floor(viewport.height)}px`,
      pointerEvents: 'auto',
    });
    layer.style.setProperty('--scale-factor', String(viewport.scale));
    wrapper.appendChild(layer);

    let textContent = await page.getTextContent();
    let renderTask = (globalThis as any).pdfjsLib.renderTextLayer({
      textContent,
      container: layer,
      viewport,
      textDivs: [],
      enhanceTextSelection: true,
    });

    if (renderTask.promise) await renderTask.promise;
  }

  @action
  addHighlightFromSelection() {
    let selection = globalThis.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    let range = selection.getRangeAt(0);
    let bounds = this.normalizedSelectionBounds(range);
    let text = selection.toString().trim();
    if (!bounds.length || !text) return;

    this.saveHighlights([
      ...this.highlights,
      {
        id: `highlight-${Date.now()}`,
        type: 'highlight',
        pageNumber: this.pageNumber,
        text,
        color: '#facc15',
        bounds,
      },
    ]);

    selection.removeAllRanges();
    this.renderHighlights();
  }

  private normalizedSelectionBounds(range: Range): NormalizedBounds[] {
    let layer = this.canvas?.parentElement?.querySelector(
      '.textLayer',
    ) as HTMLElement | null;
    if (!layer) return [];

    let layerRect = layer.getBoundingClientRect();

    return Array.from(range.getClientRects())
      .map((rect) => ({
        x: (rect.left - layerRect.left) / layer.offsetWidth,
        y: (rect.top - layerRect.top) / layer.offsetHeight,
        width: rect.width / layer.offsetWidth,
        height: rect.height / layer.offsetHeight,
      }))
      .filter((b) => b.width > 0 && b.height > 0)
      .map((b) => ({
        x: Math.max(0, Math.min(1, b.x)),
        y: Math.max(0, Math.min(1, b.y)),
        width: Math.max(0, Math.min(1 - b.x, b.width)),
        height: Math.max(0, Math.min(1 - b.y, b.height)),
      }));
  }

  private renderHighlights() {
    let layer = this.canvas?.parentElement?.querySelector(
      '.textLayer',
    ) as HTMLElement | null;
    if (!layer) return;

    layer.querySelectorAll('.persistent-highlight').forEach((el) => {
      el.remove();
    });

    this.highlights
      .filter((highlight) => highlight.pageNumber === this.pageNumber)
      .forEach((highlight) => {
        highlight.bounds.forEach((bounds) => {
          let mark = document.createElement('span');
          mark.className = 'persistent-highlight';
          Object.assign(mark.style, {
            position: 'absolute',
            left: `${bounds.x * 100}%`,
            top: `${bounds.y * 100}%`,
            width: `${bounds.width * 100}%`,
            height: `${bounds.height * 100}%`,
            background: highlight.color,
            opacity: '0.35',
            pointerEvents: 'none',
          });
          layer.appendChild(mark);
        });
      });
  }

  @action
  previousPage() {
    if (this.pageNumber > 1) {
      this.renderPage.perform(this.pageNumber - 1);
    }
  }

  @action
  nextPage() {
    if (this.pageNumber < this.totalPages) {
      this.renderPage.perform(this.pageNumber + 1);
    }
  }

  <template>
    <article class='pdf-annotator'>
      <header>
        <h1>{{@model.cardTitle}}</h1>
        <div class='controls'>
          <Button @kind='secondary' {{on 'click' this.previousPage}}>Prev</Button>
          <span>{{this.pageNumber}} / {{this.totalPages}}</span>
          <Button @kind='secondary' {{on 'click' this.nextPage}}>Next</Button>
          <Button @kind='primary' {{on 'click' this.addHighlightFromSelection}}>
            Highlight selection
          </Button>
        </div>
      </header>

      {{#if this.pdfUrl}}
        <div class='page-wrap'>
          <canvas {{pdfCanvas this}}></canvas>
        </div>
      {{else}}
        <p class='empty'>Link a PDF FileDef to start annotating.</p>
      {{/if}}

      {{#if this.errorMessage}}
        <p class='error'>{{this.errorMessage}}</p>
      {{/if}}
    </article>

    <style scoped>
      .pdf-annotator {
        display: grid;
        gap: 1rem;
        padding: 1rem;
        background: var(--background, #f8fafc);
        color: var(--foreground, #111827);
      }

      header {
        display: grid;
        gap: 0.75rem;
      }

      h1 {
        margin: 0;
        font-size: 1.25rem;
      }

      .controls {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        align-items: center;
      }

      .page-wrap {
        position: relative;
        max-width: 100%;
        overflow: auto;
        background: white;
        box-shadow: 0 1px 8px rgb(15 23 42 / 0.16);
      }

      canvas {
        display: block;
      }

      .empty,
      .error {
        margin: 0;
        color: var(--muted-foreground, #6b7280);
      }

      .error {
        color: var(--destructive, #b91c1c);
      }
    </style>
  </template>
}

export class PdfAnnotationCard extends CardDef {
  static displayName = 'PDF Annotation';
  static icon = FileTextIcon;

  @field documentTitle = contains(StringField);
  @field pdfFile = linksTo(FileDef);
  @field pageNumber = contains(NumberField);
  @field annotationData = contains(StringField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: PdfAnnotationCard) {
      return this.documentTitle || this.pdfFile?.name || 'PDF annotation';
    },
  });

  static isolated = PdfAnnotationIsolated;
}
