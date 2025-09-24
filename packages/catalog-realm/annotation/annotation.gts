// ═══ [EDIT TRACKING: ON] Mark all changes with ⁿ ═══
import {
  CardDef,
  field,
  contains,
  containsMany,
  Component,
} from 'https://cardstack.com/base/card-api'; // ¹ Core imports
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import UrlField from 'https://cardstack.com/base/url';
import { Button } from '@cardstack/boxel-ui/components'; // ² UI components
import { fn, concat, array } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import { task } from 'ember-concurrency'; // ¹³ Task management
import { htmlSafe } from '@ember/template';
import {
  formatDateTime,
  eq,
  or,
  gt,
  multiply,
} from '@cardstack/boxel-ui/helpers';
import EditIcon from '@cardstack/boxel-icons/edit';

// Annotation types and interfaces
interface AnnotationBase {
  id: string;
  type: 'highlight' | 'note' | 'drawing' | 'comment';
  pageNumber: number;
  createdAt: string;
  color?: string;
}

interface TextHighlight extends AnnotationBase {
  type: 'highlight';
  text: string;
  bounds:
    | {
        x: number;
        y: number;
        width: number;
        height: number;
      }
    | Array<{
        x: number;
        y: number;
        width: number;
        height: number;
      }>; // Support both single bounds (legacy) and multiple bounds (accurate)
  color: string;
}

interface NoteAnnotation extends AnnotationBase {
  type: 'note';
  text: string;
  position: {
    x: number;
    y: number;
  };
  associatedText?: string; // Text that was selected when note was created
}

interface DrawingAnnotation extends AnnotationBase {
  type: 'drawing';
  paths: Array<{
    points: Array<{ x: number; y: number }>;
    color: string;
    thickness: number;
  }>;
}

interface CommentAnnotation extends AnnotationBase {
  type: 'comment';
  text: string;
  position: {
    x: number;
    y: number;
  };
}

type Annotation =
  | TextHighlight
  | NoteAnnotation
  | DrawingAnnotation
  | CommentAnnotation;

class AnnotationIsolated extends Component<typeof AnnotationCard> {
  // ⁶ Isolated format
  @tracked selectedTool = 'highlight';
  @tracked selectedColor = '#ffeb3b';
  @tracked showNotes = false; // ²⁵ Start with sidebar hidden
  @tracked currentPage = 1;
  @tracked pdfScale: number | string = 1.0; // ²⁶ PDF scaling factor
  @tracked minScale = 0.5; // ²⁷ Minimum zoom level
  @tracked maxScale = 3.0; // ²⁸ Maximum zoom level
  @tracked totalPages = 1;
  @tracked pdfDoc: any = null;
  @tracked isSelecting = false;
  @tracked selectedText = '';
  @tracked selectionRange: any = null;

  @tracked errorMessage = '';
  @tracked isDrawing = false;
  @tracked currentDrawingPath: Array<{ x: number; y: number }> = [];
  @tracked drawingThickness = 2;

  // Drawing functionality
  @action
  startDrawing(event: MouseEvent) {
    if (this.selectedTool === 'drawing') {
      event.preventDefault();
      event.stopPropagation();

      // ¹⁰⁵ CRITICAL: Validate event originated from drawing layer
      const drawingLayer = event.currentTarget as HTMLElement;
      if (!drawingLayer || !drawingLayer.classList.contains('drawing-layer')) {
        return;
      }

      const canvas = document.getElementById('pdf-canvas') as HTMLCanvasElement;
      if (!canvas) {
        console.warn('Canvas not found, cannot start drawing');
        return;
      }

      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;

      // Validate coordinates are within canvas bounds
      if (x < 0 || y < 0 || x > rect.width || y > rect.height) {
        return;
      }

      this.isDrawing = true;
      this.currentDrawingPath = [{ x, y }];
    }
  }

  @action
  continueDrawing(event: MouseEvent) {
    // ¹⁰⁶ CRITICAL: Validate drawing state before processing any mouse events
    if (
      !this.isDrawing ||
      this.selectedTool !== 'drawing' ||
      !this.currentDrawingPath
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const canvas = document.getElementById('pdf-canvas') as HTMLCanvasElement;
    if (!canvas) {
      console.warn('Canvas not found during drawing');
      this.stopDrawing();
      return;
    }

    const rect = canvas.getBoundingClientRect();
    let x = event.clientX - rect.left;
    let y = event.clientY - rect.top;

    // ¹⁰⁷ Validate coordinates are not NaN
    if (isNaN(x) || isNaN(y)) {
      console.warn('Invalid coordinates detected, stopping drawing');
      this.stopDrawing();
      return;
    }

    // Clamp coordinates to canvas bounds
    x = Math.max(0, Math.min(rect.width, x));
    y = Math.max(0, Math.min(rect.height, y));

    this.currentDrawingPath.push({ x, y });

    if (this.currentDrawingPath.length >= 2) {
      this.drawCurrentPath();
    }
  }

  @action
  stopDrawing() {
    const wasDrawing = this.isDrawing;
    const pathLength = this.currentDrawingPath.length;

    this.isDrawing = false;

    if (wasDrawing && pathLength > 1) {
      const canvas = document.getElementById('pdf-canvas') as HTMLCanvasElement;
      if (!canvas) {
        console.warn('Canvas not found when stopping drawing');
        this.currentDrawingPath = [];
        this.cleanupDrawingPreviews();
        return;
      }

      if (canvas.offsetWidth === 0 || canvas.offsetHeight === 0) {
        console.warn('Canvas has zero dimensions, cannot save drawing');
        this.currentDrawingPath = [];
        this.cleanupDrawingPreviews();
        return;
      }

      try {
        const normalizedPoints = this.currentDrawingPath.map((point) => ({
          x: Math.max(0, Math.min(1, point.x / canvas.offsetWidth)),
          y: Math.max(0, Math.min(1, point.y / canvas.offsetHeight)),
        }));

        if (
          normalizedPoints.length > 1 &&
          normalizedPoints.every((p) => !isNaN(p.x) && !isNaN(p.y))
        ) {
          const drawing: DrawingAnnotation = {
            id: `drawing_${Date.now()}_${Math.random()
              .toString(36)
              .substr(2, 9)}`,
            type: 'drawing',
            paths: [
              {
                points: normalizedPoints,
                color: this.selectedColor,
                thickness: Math.max(
                  0.001,
                  Math.min(0.1, this.drawingThickness / canvas.offsetWidth),
                ),
              },
            ],
            pageNumber: this.currentPage,
            createdAt: this.createTimestamp(),
            color: this.selectedColor,
          };

          this.addAnnotation(drawing);
        }
      } catch (error) {
        console.error('Error processing drawing:', error);
      }
    }

    this.currentDrawingPath = [];
    this.cleanupDrawingPreviews();
  }

  private drawCurrentPath() {
    const canvas = document.getElementById('pdf-canvas') as HTMLCanvasElement;
    if (!canvas || this.currentDrawingPath.length < 2) return;

    try {
      // ⁹³ CRITICAL: Cleanup any existing preview first to prevent accumulation
      this.cleanupDrawingPreviews();

      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = canvas.width;
      tempCanvas.height = canvas.height;
      tempCanvas.style.position = 'absolute';
      tempCanvas.style.top = '0';
      tempCanvas.style.left = '0';
      tempCanvas.style.pointerEvents = 'none';
      tempCanvas.style.zIndex = '30';
      tempCanvas.style.width = canvas.style.width;
      tempCanvas.style.height = canvas.style.height;
      tempCanvas.className = 'drawing-preview';

      const parent = canvas.parentElement;
      if (!parent) {
        console.warn('Canvas parent not found for preview');
        return;
      }

      parent.appendChild(tempCanvas);

      const tempCtx = tempCanvas.getContext('2d');
      if (!tempCtx) return;

      // ⁹⁴ Validate device pixel ratio and drawing path
      const devicePixelRatio = Math.max(1, window.devicePixelRatio || 1);
      tempCtx.scale(devicePixelRatio, devicePixelRatio);

      tempCtx.strokeStyle = this.selectedColor;
      tempCtx.lineWidth = Math.max(1, this.drawingThickness); // ⁹⁵ Ensure minimum line width
      tempCtx.lineCap = 'round';
      tempCtx.lineJoin = 'round';

      tempCtx.beginPath();
      const startPoint = this.currentDrawingPath[0];
      tempCtx.moveTo(startPoint.x, startPoint.y);

      for (let i = 1; i < this.currentDrawingPath.length; i++) {
        const point = this.currentDrawingPath[i];
        // ⁹⁶ Validate each point before drawing
        if (!isNaN(point.x) && !isNaN(point.y)) {
          tempCtx.lineTo(point.x, point.y);
        }
      }

      tempCtx.stroke();
    } catch (error) {
      console.error('Error drawing current path:', error);
      this.cleanupDrawingPreviews(); // Clean up on error
    }
  }

  // Helper method to create ISO timestamp with fallbacks
  private createTimestamp(): string {
    try {
      // Try standard Date first
      return new Date().toISOString();
    } catch (e) {
      try {
        // Fallback to Date.now() + manual formatting
        const now = Date.now();
        const date = new Date(now);
        return date.toISOString();
      } catch (e2) {
        // Final fallback - manual ISO string creation
        const now = Date.now();
        const date = new Date(now);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');
        return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.000Z`;
      }
    }
  }

  private getCanvas(): HTMLCanvasElement | null {
    return document.getElementById('pdf-canvas') as HTMLCanvasElement | null;
  }
  private getPageWrapper(): HTMLElement | null {
    const c = this.getCanvas();
    return (c?.parentElement as HTMLElement) ?? null; // .pageLayer
  }

  // Clean selected text to remove extra whitespace and line breaks
  private cleanupSelectedText(text: string): string {
    return text
      .replace(/\s+/g, ' ') // Replace multiple spaces with single space
      .replace(/\n+/g, ' ') // Replace line breaks with spaces
      .trim(); // Remove leading/trailing whitespace
  }

  // Annotation storage
  get annotations() {
    try {
      if (this.args.model?.annotationData) {
        return JSON.parse(this.args.model.annotationData);
      }
    } catch (e) {
      console.error('Failed to parse annotation data:', e);
    }
    return [];
  }

  private getAnnotations(): Annotation[] {
    if (!this.args.model?.annotationData) {
      return [];
    }

    try {
      return JSON.parse(this.args.model.annotationData);
    } catch (e) {
      console.error('Failed to parse annotation data:', e);
      return [];
    }
  }

  private saveAnnotations(annotations: Annotation[]) {
    if (this.args.model) {
      const annotationDataString = JSON.stringify(annotations);

      this.args.model.annotationData = annotationDataString;
      this.args.model.createdAt = this.createTimestamp();
    } else {
      console.error('No model available for saving annotations');
    }
  }

  private addAnnotation(annotation: Annotation) {
    const annotations = this.getAnnotations();

    // Create a new array with the new annotation
    const updatedAnnotations = [...annotations, annotation];

    this.saveAnnotations(updatedAnnotations);

    // ⁷² Force re-render of annotations for the current page
    if (annotation.pageNumber === this.currentPage) {
      // ⁷³ Also trigger immediate redraw for drawings
      if (annotation.type === 'drawing') {
        setTimeout(() => {
          this.redrawStoredAnnotations(this.currentPage);
        }, 50);
      }
    }
  }

  get annotationsForCurrentPage() {
    const allAnnotations = this.getAnnotations();
    const currentPageAnnotations = allAnnotations.filter(
      (ann) => ann.pageNumber === this.currentPage,
    );

    return currentPageAnnotations as any;
  }

  private getAnnotationsForPage(pageNumber: number): Annotation[] {
    const allAnnotations = this.getAnnotations();
    const pageAnnotations = allAnnotations.filter(
      (ann) => ann.pageNumber === pageNumber,
    );

    return pageAnnotations;
  }

  // ¹⁵ PDF.js integration
  private loadPDFjs = task(async () => {
    try {
      // Load PDF.js CSS first
      if (!document.querySelector('link[href*="pdf.js"]')) {
        await this.loadCSS(
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf_viewer.css',
        );
      }

      // Load PDF.js from CDN
      if (!(globalThis as any).pdfjsLib) {
        await this.loadScript(
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
        );
        // Configure worker
        (globalThis as any).pdfjsLib.GlobalWorkerOptions.workerSrc =
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      }

      // Wait a moment for PDF.js to fully initialize
      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch (error) {
      console.error('Failed to load PDF.js', error);
      this.errorMessage = 'Failed to load PDF viewer';
    }
  });

  private loadScript(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = () => resolve();
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  private loadCSS(href: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.onload = () => resolve();
      link.onerror = reject;
      document.head.appendChild(link);
    });
  }

  // ¹⁶ PDF document loading
  private loadPDF = task(async (url: string) => {
    try {
      await this.loadPDFjs.perform();
      const pdfjsLib = (globalThis as any).pdfjsLib;

      if (!pdfjsLib) {
        throw new Error('PDF.js not loaded');
      }

      const loadingTask = pdfjsLib.getDocument(url);
      this.pdfDoc = await loadingTask.promise;
      this.totalPages = this.pdfDoc.numPages;

      // Use saved page number from model, or default to 1
      const savedPage = this.args.model?.pageNumber || 1;
      this.currentPage = Math.min(Math.max(1, savedPage), this.totalPages);

      // Render the saved page (or page 1 if no saved page)
      this.renderPage.perform(this.currentPage);
    } catch (error: any) {
      console.error('Failed to load PDF', error);
      this.errorMessage = `Failed to load PDF: ${error.message || error}`;
    }
  });

  // ¹⁷ Page rendering with improved reliability and better timing
  private renderPage = task(async (pageNum: number) => {
    if (!this.pdfDoc) {
      console.warn('No PDF document loaded');
      return;
    }

    try {
      // Validate page number is within bounds
      if (pageNum < 1 || pageNum > this.totalPages) {
        console.warn(`Page ${pageNum} is out of bounds (1-${this.totalPages})`);
        return;
      }

      const page = await this.pdfDoc.getPage(pageNum);

      // Wait longer and check multiple times for canvas readiness
      let canvas: HTMLCanvasElement | null = null;
      let canvasAttempts = 0;
      const maxCanvasAttempts = 10;

      while (!canvas && canvasAttempts < maxCanvasAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        canvas = document.getElementById('pdf-canvas') as HTMLCanvasElement;
        canvasAttempts++;
      }

      if (!canvas) {
        console.error('Canvas element not found after multiple attempts');
        this.errorMessage =
          'PDF viewer canvas not ready. Please reload or try again.';
        return;
      }

      const context = canvas.getContext('2d');
      if (!context) {
        console.error('Could not get canvas 2D context');
        this.errorMessage = 'Canvas rendering not supported in this browser';
        return;
      }

      // Calculate scale based on container width
      const container = canvas.parentElement;
      const containerWidth = container ? container.clientWidth : 800;
      const baseViewport = page.getViewport({ scale: 1 });

      let scale: number;
      if (this.pdfScale === 'fit-width') {
        const targetWidth = containerWidth - 20; // Some margin
        scale = targetWidth / baseViewport.width;
        this.pdfScale = scale; // Update tracked scale for UI display
      } else {
        scale =
          typeof this.pdfScale === 'number' && this.pdfScale > 0
            ? this.pdfScale
            : 1.0;
      }

      const viewport = page.getViewport({ scale });

      const wrapper = canvas.parentElement as HTMLElement;
      if (wrapper) {
        wrapper.style.position = 'relative';
        wrapper.style.width = `${Math.floor(viewport.width)}px`;
        wrapper.style.height = `${Math.floor(viewport.height)}px`;
      }

      const outputScale = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * outputScale);
      canvas.height = Math.floor(viewport.height * outputScale);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;

      const transform =
        outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null;
      await page.render({ canvasContext: context, viewport, transform })
        .promise;
      canvas.style.maxWidth = '100%';
      canvas.style.display = 'block';

      // Update model with current page
      if (this.args.model) {
        this.args.model.pageNumber = pageNum;
      }

      // Create text layer for text selection usi.textLayerng PDF.js TextLayerBuilder
      await this.createTextLayer(page, viewport, canvas);

      // Clear any existing text selection when rendering a new page
      this.clearTextSelection();

      // Render highlights in text layer
      this.renderPageHighlights(pageNum);

      // ⁷⁴ Important: Re-render any existing drawings after page render
      setTimeout(() => {
        this.redrawStoredAnnotations(pageNum);

        // ⁷⁸ CRITICAL: Clean up any drawing preview elements from previous drawings
        this.cleanupDrawingPreviews();
      }, 150); // ⁷⁵ Slightly longer delay to ensure PDF rendering is complete

      // Clear any previous error message
      this.errorMessage = '';
    } catch (error: any) {
      console.error('Failed to render page', error);
      this.errorMessage = `Failed to render page ${pageNum}: ${error.message}. Try refreshing the page.`;
    }
  });

  // Create text layer for text selection using PDF.js CDN API
  private async createTextLayer(
    page: any,
    viewport: any,
    canvas: HTMLCanvasElement,
  ) {
    try {
      // Remove any existing textLayer
      const existingTextLayer =
        canvas.parentElement?.querySelector('.textLayer');
      if (existingTextLayer) existingTextLayer.remove();

      const canvasContainer = canvas.parentElement;
      if (!canvasContainer) return;

      const textLayerDiv = document.createElement('div');
      textLayerDiv.className = 'textLayer';
      Object.assign(textLayerDiv.style, {
        position: 'absolute',
        left: '0',
        top: '0',
        width: `${Math.floor(viewport.width)}px`,
        height: `${Math.floor(viewport.height)}px`,
        pointerEvents: 'auto',
        zIndex: '20',
      });

      textLayerDiv.style.setProperty('--scale-factor', String(viewport.scale));
      canvasContainer.appendChild(textLayerDiv);

      // Get PDF.js text content
      const textContent = await page.getTextContent();
      const pdfjsLib = (globalThis as any).pdfjsLib;

      if (!pdfjsLib?.renderTextLayer) {
        console.error('PDF.js renderTextLayer not available');
        return;
      }

      // Render the text layer
      const renderTask = pdfjsLib.renderTextLayer({
        textContent,
        container: textLayerDiv,
        viewport,
        textDivs: [],
        enhanceTextSelection: true,
      });

      if (renderTask.promise) await renderTask.promise;

      // Attach selection handler
      textLayerDiv.addEventListener(
        'mouseup',
        this.handlePDFTextSelection.bind(this),
      );
    } catch (error: any) {
      console.error('Failed to create text layer', error);
    }
  }

  // Render highlights in text layer, not on canvas
  private renderPageHighlights(pageNum: number) {
    const wrapper = this.getPageWrapper();
    if (!wrapper) return;
    const textLayer = wrapper.querySelector('.textLayer');
    if (!textLayer) return;

    // Remove existing persistent highlights
    textLayer
      .querySelectorAll('.persistent-highlight')
      .forEach((el) => el.remove());

    // Get highlights for current page
    const highlights = this.getAnnotationsForPage(pageNum).filter(
      (ann) => ann.type === 'highlight',
    ) as TextHighlight[];

    highlights.forEach((highlight) => {
      // Handle both single bounds (legacy) and multiple bounds (new)
      const boundsArray = Array.isArray(highlight.bounds)
        ? highlight.bounds
        : [highlight.bounds];

      this.createTextLayerHighlight(boundsArray, highlight.color);
    });
  }

  // Export annotations as JSON
  @action
  exportAnnotations() {
    const annotations = this.getAnnotations();
    const dataStr = JSON.stringify(annotations, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });

    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `annotations_${
      this.args.model?.documentTitle || 'document'
    }.json`;
    link.click();

    URL.revokeObjectURL(url);
  }

  // Clear all annotations
  @action
  clearAllAnnotations() {
    if (
      confirm(
        'Are you sure you want to clear all annotations? This cannot be undone.',
      )
    ) {
      this.saveAnnotations([]);
      // Re-render current page to clear annotations
      this.renderPage.perform(this.currentPage);
    }
  }

  // Clear annotations for current page only
  @action
  clearCurrentPageAnnotations() {
    if (this.args.model) {
      const allAnnotations = this.getAnnotations();
      const otherPageAnnotations = allAnnotations.filter(
        (ann) => ann.pageNumber !== this.currentPage,
      );

      if (otherPageAnnotations.length > 0) {
        this.args.model.annotationData = JSON.stringify(otherPageAnnotations);
      } else {
        this.args.model.annotationData = '';
      }

      this.args.model.createdAt = this.createTimestamp();

      // ³⁶ Re-render the entire page to clear all annotations properly
      this.renderPage.perform(this.currentPage);
    }
  }

  // ⁷⁰ Fixed method: Re-draw stored annotations with proper page filtering
  private redrawStoredAnnotations(pageNum: number) {
    const canvas = document.getElementById('pdf-canvas') as HTMLCanvasElement;
    if (!canvas) {
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    // ⁷⁶ CRITICAL: Clear any existing drawing overlay first
    let drawingCanvas = canvas.parentElement?.querySelector(
      '.drawing-overlay',
    ) as HTMLCanvasElement;
    if (drawingCanvas) {
      const drawingCtx = drawingCanvas.getContext('2d');
      if (drawingCtx) {
        drawingCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
      }
    }

    // ⁷¹ CRITICAL: Filter annotations by exact page number
    const allAnnotations = this.getAnnotations();

    const pageAnnotations = allAnnotations.filter(
      (ann) => ann.pageNumber === pageNum,
    );

    const drawings = pageAnnotations.filter(
      (ann) => ann.type === 'drawing',
    ) as DrawingAnnotation[];

    // ⁷⁷ If no drawings for this page, ensure overlay is cleared and return
    if (drawings.length === 0) {
      return;
    }

    // ⁵⁷ Create or reuse dedicated drawing overlay canvas
    if (!drawingCanvas) {
      drawingCanvas = document.createElement('canvas');
      drawingCanvas.className = 'drawing-overlay';
      drawingCanvas.style.position = 'absolute';
      drawingCanvas.style.top = '0';
      drawingCanvas.style.left = '0';
      drawingCanvas.style.pointerEvents = 'none';
      drawingCanvas.style.zIndex = '25';
      canvas.parentElement?.appendChild(drawingCanvas);
    }

    // ⁵⁸ Match the main canvas dimensions exactly
    drawingCanvas.width = canvas.width;
    drawingCanvas.height = canvas.height;
    drawingCanvas.style.width = canvas.style.width;
    drawingCanvas.style.height = canvas.style.height;

    const drawingCtx = drawingCanvas.getContext('2d');
    if (!drawingCtx) return;

    // ⁵⁹ Scale drawing context to match device pixel ratio
    const devicePixelRatio = window.devicePixelRatio || 1;
    drawingCtx.scale(devicePixelRatio, devicePixelRatio);

    // Clear previous drawings (redundant but ensures clean state)
    drawingCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);

    drawings.forEach((drawing) => {
      drawing.paths.forEach((path) => {
        if (path.points.length < 2) {
          return;
        }

        drawingCtx.strokeStyle = path.color;
        // ⁶⁰ Convert normalized thickness back to display pixels
        drawingCtx.lineWidth = path.thickness * canvas.offsetWidth;
        drawingCtx.lineCap = 'round';
        drawingCtx.lineJoin = 'round';

        drawingCtx.beginPath();

        // ⁶¹ Convert normalized coordinates back to display coordinates
        const startX = path.points[0].x * canvas.offsetWidth;
        const startY = path.points[0].y * canvas.offsetHeight;
        drawingCtx.moveTo(startX, startY);

        for (let i = 1; i < path.points.length; i++) {
          const x = path.points[i].x * canvas.offsetWidth;
          const y = path.points[i].y * canvas.offsetHeight;
          drawingCtx.lineTo(x, y);
        }

        drawingCtx.stroke();
      });
    });
  }

  // ⁹⁷ Enhanced cleanup with error handling and safety checks
  private cleanupDrawingPreviews() {
    try {
      const canvas = document.getElementById('pdf-canvas') as HTMLCanvasElement;
      if (!canvas || !canvas.parentElement) {
        // Also try to find any orphaned preview canvases in the document
        const orphanedPreviews = document.querySelectorAll('.drawing-preview');
        orphanedPreviews.forEach((preview) => {
          preview.remove();
        });
        return;
      }

      // Remove all drawing preview canvases from the canvas container
      const previewCanvases =
        canvas.parentElement.querySelectorAll('.drawing-preview');
      previewCanvases.forEach((preview) => {
        try {
          preview.remove();
        } catch (removeError) {
          console.warn('Error removing preview canvas:', removeError as any);
        }
      });

      // ⁹⁸ Also clear any temporary canvas contexts that might be lingering
      const tempCanvases = canvas.parentElement.querySelectorAll(
        'canvas:not(#pdf-canvas):not(.drawing-overlay)',
      );
      tempCanvases.forEach((tempCanvas) => {
        if (
          tempCanvas.className.includes('preview') ||
          tempCanvas.className.includes('temp')
        ) {
          tempCanvas.remove();
        }
      });
    } catch (error: any) {
      console.error('Error during drawing preview cleanup:', error);
    }
  }

  // Clear text selection
  // ¹⁰⁸ Handle mouse entering drawing area during external drag
  @action
  handleMouseEnterWhileDrawing(event: MouseEvent) {
    // If mouse enters the drawing area while button is pressed but no valid drawing state,
    // it means the drag started outside - ignore these events
    if (event.buttons > 0 && !this.isDrawing) {
      event.preventDefault();
      event.stopPropagation();
      return false;
    }
    return;
  }

  @action
  clearTextSelection() {
    // Clear stored selection data
    this.selectedText = '';
    this.selectionRange = null;

    // Clear browser selection
    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
    }

    // Remove visual highlight
    const wrapper = this.getPageWrapper();
    if (!wrapper) return;
    const textLayer = wrapper.querySelector('.textLayer');
    if (textLayer) {
      const highlights = textLayer.querySelectorAll('.selection-highlight');
      highlights.forEach((el) => el.remove());
    }

    // Hide selection action buttons if they exist
    const selectionActions = document.querySelector('.selection-actions');
    if (selectionActions) {
      (selectionActions as HTMLElement).style.display = 'none';
    }
  }

  // Check if the current text selection is valid for the current page
  private isSelectionValid(selection: Selection): boolean {
    if (!selection.rangeCount) return false;

    const range = selection.getRangeAt(0);
    const wrapper = this.getPageWrapper();
    if (!wrapper) return false;
    const textLayer = wrapper.querySelector('.textLayer');

    if (!textLayer) return false;

    // Get all selection rects and check if they intersect with text layer
    const rects = Array.from(range.getClientRects());
    const textLayerRect = textLayer.getBoundingClientRect();

    if (rects.length === 0) return false;

    // Check if any rect intersects with text layer bounds
    return rects.some(
      (rect) =>
        rect.right > textLayerRect.left &&
        rect.left < textLayerRect.right &&
        rect.bottom > textLayerRect.top &&
        rect.top < textLayerRect.bottom &&
        (textLayer.contains(range.commonAncestorContainer) ||
          textLayer.contains(range.startContainer) ||
          textLayer.contains(range.endContainer)),
    );
  }

  get truncatedSelectedText() {
    // ¹¹² Safe text truncation for templates
    const text = this.selectedText || '';
    const maxLength = 35;
    return text.length > maxLength
      ? `${text.substring(0, maxLength)}...`
      : text;
  }

  truncateText(text: string, maxLength: number): string {
    // ¹¹³ Helper for annotation text truncation
    if (!text || text.length <= maxLength) return text;
    return `${text.substring(0, maxLength)}...`;
  }

  get annotationTools() {
    // ⁷ Annotation tools - simplified to highlight and drawing only
    return [
      { id: 'highlight', name: 'Highlight', icon: 'marker' },
      { id: 'drawing', name: 'Draw', icon: 'pen' },
    ];
  }

  get highlightColors() {
    return [
      { name: 'Yellow', value: '#ffeb3b' },
      { name: 'Green', value: '#4caf50' },
      { name: 'Blue', value: '#2196f3' },
      { name: 'Pink', value: '#e91e63' },
      { name: 'Orange', value: '#ff9800' },
    ];
  }

  @action
  selectTool(toolId: string) {
    this.selectedTool = toolId;

    // ¹¹⁵ Clear any existing text selection when switching to drawing mode
    if (toolId === 'drawing') {
      this.clearTextSelection();

      // ¹¹⁹ CRITICAL: Force clear browser selection and disable selectstart
      window.getSelection()?.removeAllRanges();

      // Prevent new selections from starting
      const preventSelection = (e: Event) => {
        if (this.selectedTool === 'drawing') {
          e.preventDefault();
          return false;
        }
        return;
      };

      // Add temporary event listeners to prevent selection
      document.addEventListener('selectstart', preventSelection);
      document.addEventListener('dragstart', preventSelection);

      // Clean up when switching away from drawing mode
      setTimeout(() => {
        if (this.selectedTool !== 'drawing') {
          document.removeEventListener('selectstart', preventSelection);
          document.removeEventListener('dragstart', preventSelection);
        }
      }, 100);
    } else {
      // ¹²⁰ Re-enable text selection when switching away from drawing
      const enableSelection = () => {
        document.removeEventListener('selectstart', this.preventSelection);
        document.removeEventListener('dragstart', this.preventSelection);
      };
      enableSelection();
    }
  }

  // ¹²¹ Store prevention function for cleanup
  private preventSelection = (e: Event) => {
    if (this.selectedTool === 'drawing') {
      e.preventDefault();
      return false;
    }
    return true;
  };

  @action
  selectColor(color: string) {
    this.selectedColor = color;
  }

  @action
  toggleNotes() {
    this.showNotes = !this.showNotes;
  }

  // ¹⁸ Navigation actions
  @action
  previousPage() {
    if (this.currentPage > 1) {
      this.currentPage--;
      // Update model with new page number
      if (this.args.model) {
        this.args.model.pageNumber = this.currentPage;
      }
      // Clear text selection when changing pages
      this.clearTextSelection();
      // ⁸² CRITICAL: Clean up drawing previews when changing pages
      this.cleanupDrawingPreviews();
      // Force a small delay to ensure container is ready
      setTimeout(() => {
        this.renderPage.perform(this.currentPage);
      }, 50);
    }
  }

  @action
  nextPage() {
    if (this.currentPage < this.totalPages) {
      this.currentPage++;
      // Update model with new page number
      if (this.args.model) {
        this.args.model.pageNumber = this.currentPage;
      }
      // Clear text selection when changing pages
      this.clearTextSelection();
      // ⁸³ CRITICAL: Clean up drawing previews when changing pages
      this.cleanupDrawingPreviews();
      // Force a small delay to ensure container is ready
      setTimeout(() => {
        this.renderPage.perform(this.currentPage);
      }, 50);
    }
  }

  // ²⁹ PDF scaling actions
  @action
  zoomIn() {
    if ((this.pdfScale as number) < this.maxScale) {
      this.pdfScale = Math.min(this.maxScale, (this.pdfScale as number) + 0.25);
      this.renderPage.perform(this.currentPage);
    }
  }

  @action
  zoomOut() {
    if ((this.pdfScale as number) > this.minScale) {
      this.pdfScale = Math.max(this.minScale, (this.pdfScale as number) - 0.25);
      this.renderPage.perform(this.currentPage);
    }
  }

  @action
  resetZoom() {
    this.pdfScale = 1.0;
    this.renderPage.perform(this.currentPage);
  }

  @action
  fitToWidth() {
    // Will be calculated in renderPage based on container width
    this.pdfScale = 'fit-width';
    this.renderPage.perform(this.currentPage);
  }

  // ¹⁹ File upload handling
  @action
  async handleFileUpload(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (file && file.type === 'application/pdf') {
      try {
        // Create blob URL for the uploaded file
        const url = URL.createObjectURL(file);

        // Update model
        if (this.args.model) {
          this.args.model.documentUrl = url;
          this.args.model.documentTitle = file.name.replace('.pdf', '');
        }

        // Load the PDF
        await this.loadPDF.perform(url);
      } catch (error: any) {
        this.errorMessage = `Failed to upload file: ${error.message}`;
      }
    } else {
      this.errorMessage = 'Please select a valid PDF file';
    }
  }

  // ²⁰ Text selection handling
  @action
  handleTextSelection() {
    // ¹¹⁷ CRITICAL: Don't process text selection when in drawing mode
    if (this.selectedTool === 'drawing') {
      return;
    }

    // Check if we have a text selection from the PDF text layer
    const selection = window.getSelection();
    if (selection && selection.toString().length > 0) {
      this.selectedText = selection.toString().trim();
      this.selectionRange = selection.getRangeAt(0);

      if (this.selectedTool === 'highlight') {
        this.addTextHighlight();
      } else if (this.selectedTool === 'note') {
        this.showNotes = true;
      } else if (this.selectedTool === 'comment') {
        this.showNotes = true;
      }
    }
  }

  // Handle text selection from PDF text layer
  @action
  handlePDFTextSelection(event: MouseEvent) {
    // ¹¹⁴ CRITICAL: Don't process text selection when in drawing mode
    if (this.selectedTool === 'drawing') {
      return;
    }

    // ¹¹⁶ CRITICAL: Also ignore if mouse was pressed outside and dragged in
    if (event.buttons > 0) {
      return;
    }

    // Small delay to ensure selection is complete
    setTimeout(() => {
      const selection = window.getSelection();
      if (selection && selection.toString().length > 0) {
        // Verify the selection is from the current page's text layer
        if (!this.isSelectionValid(selection)) {
          this.clearTextSelection();
          return;
        }

        let rawText = selection.toString();

        // Clean up the selected text to remove padding characters
        this.selectedText = this.cleanupSelectedText(rawText);
        this.selectionRange = selection.getRangeAt(0);

        // Highlight the selected text in the text layer
        this.highlightSelectedText();

        // Auto-create highlight if highlight tool is selected
        if (
          this.selectedTool === 'highlight' &&
          this.selectedText.trim().length > 0
        ) {
          this.addTextHighlight();
        }
      }
    }, 50);
  }

  // Create persistent highlights in text layer using normalized coordinates
  private createTextLayerHighlight(
    bounds: Array<{ x: number; y: number; width: number; height: number }>,
    color: string,
  ) {
    const wrapper = this.getPageWrapper();
    if (!wrapper) {
      return;
    }
    const textLayer = wrapper.querySelector('.textLayer') as HTMLElement;
    if (!textLayer) {
      return;
    }

    // Get current viewport scale for proper highlight positioning

    // Convert normalized bounds back to text layer coordinates
    // The text layer size already reflects the current scale, so we don't need to scale again
    const textLayerWidth = textLayer.offsetWidth;
    const textLayerHeight = textLayer.offsetHeight;

    bounds.forEach((normalizedBound, index) => {
      const highlight = document.createElement('div');
      highlight.className = 'persistent-highlight';
      highlight.dataset.annotationId = `temp_${Date.now()}_${index}`;

      // Convert from normalized (0-1) to actual text layer pixels
      // The text layer already has the correct dimensions for the current scale
      const left = normalizedBound.x * textLayerWidth;
      const top = normalizedBound.y * textLayerHeight;
      const width = normalizedBound.width * textLayerWidth;
      const height = normalizedBound.height * textLayerHeight;

      // CRITICAL: Ensure highlight is visible above text layer
      highlight.style.cssText = `
        position: absolute !important;
        left: ${left}px;
        top: ${top}px;
        width: ${width}px;
        height: ${height}px;
        background: ${color}60 !important;
        border: 1px solid ${color}90 !important;
        pointer-events: none !important;
        z-index: 25 !important;
        border-radius: 2px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        mix-blend-mode: multiply;
      `;

      textLayer.appendChild(highlight);
    });
  }

  // Highlight the selected text temporarily in the text layer
  private highlightSelectedText() {
    if (!this.selectionRange) return;

    const wrapper = this.getPageWrapper();
    if (!wrapper) return;
    const textLayer = wrapper.querySelector('.textLayer');
    if (!textLayer) return;

    // Remove existing temporary highlights
    textLayer
      .querySelectorAll('.selection-highlight')
      .forEach((el) => el.remove());

    const rects = Array.from(this.selectionRange.getClientRects());
    const textLayerRect = textLayer.getBoundingClientRect();

    rects.forEach((rect: any) => {
      if (
        rect.width > 0 &&
        rect.height > 0 &&
        rect.right > textLayerRect.left &&
        rect.left < textLayerRect.right &&
        rect.bottom > textLayerRect.top &&
        rect.top < textLayerRect.bottom
      ) {
        const highlight = document.createElement('div');
        highlight.className = 'selection-highlight';

        const relativeLeft = rect.left - textLayerRect.left;
        const relativeTop = rect.top - textLayerRect.top;

        highlight.style.cssText = `
        position: absolute;
        left: ${relativeLeft}px;
        top: ${relativeTop}px;
        width: ${rect.width}px;
        height: ${rect.height}px;
        background: rgba(0, 123, 255, 0.3);
        border: 1px solid rgba(0, 123, 255, 0.5);
        pointer-events: none;
        z-index: 25;
        border-radius: 2px;
      `;

        textLayer.appendChild(highlight);
      }
    });
  }

  // Get normalized text selection bounds for PDF coordinates
  private getTextSelectionBounds(): Array<{
    x: number;
    y: number;
    width: number;
    height: number;
  }> {
    if (!this.selectionRange) {
      return [];
    }

    // Get current viewport for normalization
    const wrapper = this.getPageWrapper();
    if (!wrapper) return [];
    const textLayer = wrapper.querySelector('.textLayer') as HTMLElement;
    if (!textLayer) {
      return [];
    }

    // Use getClientRects for accurate text bounds
    const rects = Array.from(this.selectionRange.getClientRects());
    const textLayerRect = textLayer.getBoundingClientRect();

    // Convert to normalized PDF coordinates (0-1 relative to page)
    const bounds = rects
      .map((rect: any) => {
        // Check if rect intersects with text layer
        if (
          rect.right < textLayerRect.left ||
          rect.left > textLayerRect.right ||
          rect.bottom < textLayerRect.top ||
          rect.top > textLayerRect.bottom
        ) {
          return null;
        }

        // Calculate relative to text layer
        const relativeToTextLayer = {
          x: rect.left - textLayerRect.left,
          y: rect.top - textLayerRect.top,
          width: rect.width,
          height: rect.height,
        };

        // Normalize to PDF coordinates (0-1)
        const normalizedBounds = {
          x: relativeToTextLayer.x / textLayer.offsetWidth,
          y: relativeToTextLayer.y / textLayer.offsetHeight,
          width: relativeToTextLayer.width / textLayer.offsetWidth,
          height: relativeToTextLayer.height / textLayer.offsetHeight,
        };

        // Clamp to valid range
        normalizedBounds.x = Math.max(0, Math.min(1, normalizedBounds.x));
        normalizedBounds.y = Math.max(0, Math.min(1, normalizedBounds.y));
        normalizedBounds.width = Math.max(
          0,
          Math.min(1 - normalizedBounds.x, normalizedBounds.width),
        );
        normalizedBounds.height = Math.max(
          0,
          Math.min(1 - normalizedBounds.y, normalizedBounds.height),
        );

        return normalizedBounds;
      })
      .filter((bound): bound is NonNullable<typeof bound> => bound !== null);

    const validBounds = bounds.filter(
      (bound) => bound.width > 0 && bound.height > 0,
    );

    return validBounds;
  }

  // ²¹ Annotation actions
  @action
  addTextHighlight() {
    if (this.selectedText && this.args.model) {
      const boundsArray = this.getTextSelectionBounds();

      if (boundsArray.length > 0) {
        // Create highlight object
        const highlight: TextHighlight = {
          id: `highlight_${Date.now()}_${Math.random()
            .toString(36)
            .substr(2, 9)}`,
          type: 'highlight',
          text: this.selectedText,
          bounds: boundsArray.length === 1 ? boundsArray[0] : boundsArray,
          color: this.selectedColor,
          pageNumber: this.currentPage,
          createdAt: this.createTimestamp(),
        };

        // CRITICAL: Create persistent highlight IMMEDIATELY for instant feedback
        const boundsForRender = Array.isArray(highlight.bounds)
          ? highlight.bounds
          : [highlight.bounds];
        this.createTextLayerHighlight(boundsForRender, highlight.color);

        // Then save to model (slower)
        this.addAnnotation(highlight);

        // Clear selection AFTER creating persistent highlight
        window.getSelection()?.removeAllRanges();
        this.selectedText = '';
        this.selectionRange = null;

        // Remove temporary selection highlight
        const wrapper = this.getPageWrapper();
        if (wrapper) {
          const textLayer = wrapper.querySelector('.textLayer');
          if (textLayer) {
            textLayer
              .querySelectorAll('.selection-highlight')
              .forEach((el) => el.remove());
          }
        }
      } else {
      }
    } else {
      console.error('Cannot create highlight');
    }
  }

  @tracked hasInitialized = false;

  // Improved initialization with better timing
  constructor(owner: any, args: any) {
    super(owner, args);
    // Use a slightly longer delay to ensure DOM is fully ready
    setTimeout(() => {
      this.initializePDF();
    }, 500);
  }

  // Add resize observer to handle container size changes
  private setupResizeObserver() {
    const container = document.querySelector('.canvas-container');
    if (container && 'ResizeObserver' in window) {
      const resizeObserver = new ResizeObserver(() => {
        // Re-render current page when container size changes
        if (this.pdfDoc && this.currentPage) {
          this.renderPage.perform(this.currentPage);
        }
      });
      resizeObserver.observe(container);
    }
  }

  private initializePDF() {
    if (
      this.args.model?.documentUrl &&
      !this.pdfDoc &&
      !this.loadPDF.isRunning &&
      !this.hasInitialized
    ) {
      this.hasInitialized = true;

      // Add a small delay before starting PDF load to ensure UI is ready
      setTimeout(() => {
        this.loadPDF.perform(this.args.model.documentUrl as string);
        // Set up resize observer after PDF is loaded
        this.setupResizeObserver();
      }, 100);
    }
  }

  // Improved retry mechanism with full reset
  @action
  retryPDF() {
    this.errorMessage = '';
    this.hasInitialized = false;
    this.pdfDoc = null;
    this.currentPage = 1;
    this.totalPages = 1;

    // Clear the canvas
    const canvas = document.getElementById('pdf-canvas') as HTMLCanvasElement;
    if (canvas) {
      const context = canvas.getContext('2d');
      if (context) {
        context.clearRect(0, 0, canvas.width, canvas.height);
      }
    }

    setTimeout(() => {
      this.initializePDF();
    }, 100);
  }

  <template>
    <div class='annotation-isolated'>
      <header class='modern-header'>
        <div class='header-left'>
          <div class='app-branding'>
            <div class='app-icon'>
              <svg
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2.5'
              >
                <path d='M12 20h9' />
                <path
                  d='M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z'
                />
              </svg>
            </div>
            <div class='app-info'>
              <h1 class='app-title'>PDF Annotator</h1>
            </div>
          </div>
        </div>

        <div class='header-center'>
          <div class='document-info-modern'>
            <div class='doc-icon'>
              <svg
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <path
                  d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'
                ></path>
                <polyline points='14,2 14,8 20,8'></polyline>
              </svg>
            </div>
            <div class='doc-details'>
              <h2 class='doc-title'>{{if
                  @model.documentTitle
                  @model.documentTitle
                  'Untitled Document'
                }}</h2>
              <div class='doc-meta'>
                {{#if
                  (or (eq this.hasInitialized false) this.loadPDF.isRunning)
                }}
                  <span class='page-indicator'>Loading...</span>
                {{else}}
                  <span class='page-indicator'>Page
                    {{this.currentPage}}
                    of
                    {{this.totalPages}}</span>
                {{/if}}
              </div>
            </div>
          </div>
        </div>

        <div class='header-right'>
          <div class='quick-actions'>
            <Button
              class='header-action notes-toggle
                {{if this.showNotes "active" ""}}'
              {{on 'click' this.toggleNotes}}
              title='Notes ({{this.annotationsForCurrentPage.length}} on page {{this.currentPage}})'
            >
              <svg
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <path
                  d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'
                />
                <polyline points='14,2 14,8 20,8' />
                <line x1='16' y1='13' x2='8' y2='13' />
                <line x1='16' y1='17' x2='8' y2='17' />
              </svg>
              Notes ({{this.annotationsForCurrentPage.length}})
            </Button>
          </div>
        </div>
      </header>

      <div class='clean-toolbar'>
        <div class='toolbar-primary'>
          <div class='tool-cluster'>
            {{#each this.annotationTools as |tool|}}
              <Button
                class='clean-tool-btn
                  {{if (eq this.selectedTool tool.id) "active" ""}}'
                {{on 'click' (fn this.selectTool tool.id)}}
                title={{tool.name}}
              >
                <svg
                  class='tool-icon'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  {{#if (eq tool.icon 'marker')}}
                    <path d='M12 20h9' />
                    <path
                      d='M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z'
                    />
                  {{else if (eq tool.icon 'note')}}
                    <path
                      d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'
                    />
                    <polyline points='14,2 14,8 20,8' />
                  {{else if (eq tool.icon 'comment')}}
                    <path
                      d='M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'
                    />
                  {{else if (eq tool.icon 'pen')}}
                    <path
                      d='M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z'
                    />
                  {{/if}}
                </svg>
                <span class='tool-label'>{{tool.name}}</span>
              </Button>
            {{/each}}
          </div>

          {{#if (eq this.selectedTool 'highlight')}}
            <div class='tool-options'>
              <div class='color-strip'>
                {{#each this.highlightColors as |color|}}
                  <button
                    class='color-chip
                      {{if (eq this.selectedColor color.value) "selected" ""}}'
                    style={{htmlSafe (concat 'background-color: ' color.value)}}
                    {{on 'click' (fn this.selectColor color.value)}}
                    title={{color.name}}
                  >
                    {{#if (eq this.selectedColor color.value)}}
                      <svg
                        class='check-mark'
                        viewBox='0 0 24 24'
                        fill='none'
                        stroke='currentColor'
                        stroke-width='3'
                      >
                        <polyline points='20,6 9,17 4,12'></polyline>
                      </svg>
                    {{/if}}
                  </button>
                {{/each}}
              </div>
            </div>
          {{/if}}

          {{#if (eq this.selectedTool 'drawing')}}
            <div class='tool-options'>
              <div class='thickness-strip'>
                {{#each (array 1 2 4 8) as |thickness|}}
                  <button
                    class='thickness-chip
                      {{if (eq this.drawingThickness thickness) "active" ""}}'
                    {{on 'click' (fn (mut this.drawingThickness) thickness)}}
                    title='{{thickness}}px'
                  >
                    <div
                      class='thickness-preview'
                      style={{htmlSafe
                        (concat
                          'width:'
                          (multiply thickness 2)
                          'px;'
                          'height:'
                          (multiply thickness 2)
                          'px'
                        )
                      }}
                    ></div>
                  </button>
                {{/each}}
              </div>
            </div>
          {{/if}}
        </div>

        {{#if this.selectedText}}
          <div class='toolbar-selection'>
            <div class='selection-preview'>
              <svg
                class='text-icon'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <path d='M4 7h16'></path>
                <path d='M4 12h16'></path>
                <path d='M4 17h10'></path>
              </svg>
              <span class='selected-text-preview'>
                {{this.truncatedSelectedText}}
              </span>
            </div>

            <div class='quick-actions'>
              <Button
                class='quick-btn highlight-quick'
                {{on 'click' this.addTextHighlight}}
              >
                <svg
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  <path d='M12 20h9' />
                  <path
                    d='M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z'
                  />
                </svg>
                Highlight
              </Button>

              <Button
                class='quick-btn clear-quick'
                {{on 'click' this.clearTextSelection}}
              >
                <svg
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  <line x1='18' y1='6' x2='6' y2='18' />
                  <line x1='6' y1='6' x2='18' y2='18' />
                </svg>
              </Button>
            </div>
          </div>
        {{/if}}

        <div class='toolbar-secondary'>
          <Button
            class='secondary-btn clear-page-btn'
            {{on 'click' this.clearCurrentPageAnnotations}}
            title='Clear annotations on current page only'
          >
            <svg
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <path
                d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'
              />
              <polyline points='14,2 14,8 20,8' />
              <line x1='9' y1='9' x2='15' y2='15' />
              <line x1='15' y1='9' x2='9' y2='15' />
            </svg>
            Clear Page
          </Button>
        </div>
      </div>

      <main class='annotation-content'>
        <div class='document-viewer'>
          {{#if @model.documentUrl}}
            <div class='pdf-viewer'>
              <div class='pdf-header'>
                <div class='pdf-controls'>
                  <div class='page-controls'>
                    <Button
                      class='control-button'
                      disabled={{eq this.currentPage 1}}
                      {{on 'click' this.previousPage}}
                    >
                      <svg
                        viewBox='0 0 24 24'
                        fill='none'
                        stroke='currentColor'
                        stroke-width='2'
                      >
                        <polyline points='15,18 9,12 15,6'></polyline>
                      </svg>
                      Previous
                    </Button>
                    <span class='page-info'>Page
                      {{this.currentPage}}
                      of
                      {{this.totalPages}}</span>
                    <Button
                      class='control-button'
                      disabled={{eq this.currentPage this.totalPages}}
                      {{on 'click' this.nextPage}}
                    >
                      Next
                      <svg
                        viewBox='0 0 24 24'
                        fill='none'
                        stroke='currentColor'
                        stroke-width='2'
                      >
                        <polyline points='9,18 15,12 9,6'></polyline>
                      </svg>
                    </Button>
                  </div>

                  <div class='zoom-controls'>
                    <Button
                      class='zoom-button'
                      disabled={{eq this.pdfScale this.minScale}}
                      {{on 'click' this.zoomOut}}
                      title='Zoom Out'
                    >
                      <svg
                        viewBox='0 0 24 24'
                        fill='none'
                        stroke='currentColor'
                        stroke-width='2'
                      >
                        <circle cx='11' cy='11' r='8'></circle>
                        <path d='M21 21l-4.35-4.35'></path>
                        <line x1='8' y1='11' x2='14' y2='11'></line>
                      </svg>
                    </Button>

                    <span class='zoom-level'>{{if
                        (eq this.pdfScale 'fit-width')
                        'Fit'
                        (concat (multiply (Number this.pdfScale) 100) '%')
                      }}</span>

                    <Button
                      class='zoom-button'
                      disabled={{eq this.pdfScale this.maxScale}}
                      {{on 'click' this.zoomIn}}
                      title='Zoom In'
                    >
                      <svg
                        viewBox='0 0 24 24'
                        fill='none'
                        stroke='currentColor'
                        stroke-width='2'
                      >
                        <circle cx='11' cy='11' r='8'></circle>
                        <path d='M21 21l-4.35-4.35'></path>
                        <line x1='11' y1='8' x2='11' y2='14'></line>
                        <line x1='8' y1='11' x2='14' y2='11'></line>
                      </svg>
                    </Button>

                    <Button
                      class='zoom-button fit-width'
                      {{on 'click' this.fitToWidth}}
                      title='Fit to Width'
                    >
                      <svg
                        viewBox='0 0 24 24'
                        fill='none'
                        stroke='currentColor'
                        stroke-width='2'
                      >
                        <path
                          d='M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3'
                        ></path>
                      </svg>
                    </Button>

                    <Button
                      class='zoom-button reset'
                      {{on 'click' this.resetZoom}}
                      title='Reset Zoom (100%)'
                    >
                      <svg
                        viewBox='0 0 24 24'
                        fill='none'
                        stroke='currentColor'
                        stroke-width='2'
                      >
                        <path d='M1 4v6h6'></path>
                        <path d='M3.51 15a9 9 0 1 0 2.13-9.36L1 10'></path>
                      </svg>
                    </Button>
                  </div>
                </div>
              </div>

              {{#if this.errorMessage}}
                <div class='error-message'>
                  <svg
                    class='error-icon'
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <circle cx='12' cy='12' r='10' />
                    <line x1='15' y1='9' x2='9' y2='15' />
                    <line x1='9' y1='9' x2='15' y2='15' />
                  </svg>
                  <div class='error-content'>
                    <div class='error-text'>{{this.errorMessage}}</div>
                    <Button class='retry-button' {{on 'click' this.retryPDF}}>
                      Retry Loading PDF
                    </Button>
                  </div>
                </div>
              {{else if this.loadPDF.isRunning}}
                <div class='loading-pdf'>
                  <svg
                    class='loading-icon'
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <path d='M21 12a9 9 0 1 1-6.219-8.56' />
                  </svg>
                  <div class='loading-text'>Loading PDF document...</div>
                </div>
              {{else}}
                <div class='pdf-content'>
                  <div
                    class='canvas-container'
                    data-drawing-mode={{if
                      (eq this.selectedTool 'drawing')
                      'true'
                      'false'
                    }}
                  >
                    {{! template-lint-disable no-invalid-interactive }}
                    <div
                      class='pageLayer'
                      {{on 'mouseup' this.handleTextSelection}}
                    >
                      {{! template-lint-disable no-pointer-down-event-binding }}
                      <div
                        class='drawing-layer'
                        {{on 'mousedown' this.startDrawing}}
                        {{on 'mousemove' this.continueDrawing}}
                        {{on 'mouseup' this.stopDrawing}}
                        {{on 'mouseleave' this.stopDrawing}}
                        {{on 'mouseenter' this.handleMouseEnterWhileDrawing}}
                      >
                        <canvas id='pdf-canvas' class='pdf-canvas'></canvas>
                      </div>
                    </div>
                  </div>
                </div>
              {{/if}}
            </div>
          {{else}}
            <div class='no-document'>
              <svg
                class='upload-icon'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <path d='M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' />
                <polyline points='7,10 12,15 17,10' />
                <line x1='12' y1='15' x2='12' y2='3' />
              </svg>
              <div class='upload-content'>
                <h3 class='upload-title'>Upload a PDF to start annotating</h3>
                <p class='upload-subtitle'>Select a PDF file from your computer</p>
                <label class='upload-button'>
                  Choose PDF File
                  <input
                    type='file'
                    accept='.pdf,application/pdf'
                    class='hidden-input'
                    {{on 'change' this.handleFileUpload}}
                  />
                </label>
              </div>
            </div>
          {{/if}}
        </div>

        {{#if this.showNotes}}
          <div class='notes-panel'>
            <div class='notes-header'>
              <h3>Highlights (Page {{this.currentPage}})</h3>
            </div>

            {{#if (gt this.annotationsForCurrentPage.length 0)}}
              <div class='notes-list'>
                {{#each this.annotationsForCurrentPage as |annotation|}}
                  <div class='note-item'>
                    <div class='note-header'>
                      <span class='note-type'>{{annotation.type}}</span>
                      <span class='note-page'>Page
                        {{annotation.pageNumber}}</span>
                      {{#if annotation.color}}
                        <div
                          class='annotation-color'
                          style={{htmlSafe
                            (concat 'background-color: ' annotation.color)
                          }}
                        ></div>
                      {{/if}}
                    </div>
                    <div class='note-content'>
                      {{#if (eq annotation.type 'highlight')}}
                        <div class='highlight-text'>
                          {{#if (gt annotation.text.length 120)}}
                            "{{this.truncateText annotation.text 120}}"
                          {{else}}
                            "{{annotation.text}}"
                          {{/if}}
                        </div>
                      {{else if (eq annotation.type 'note')}}
                        <div class='note-text'>{{annotation.text}}</div>
                      {{else if (eq annotation.type 'drawing')}}
                        <div class='drawing-indicator'>
                          <svg
                            viewBox='0 0 24 24'
                            fill='none'
                            stroke='currentColor'
                            stroke-width='2'
                          >
                            <path
                              d='M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z'
                            />
                          </svg>
                          Drawing annotation
                        </div>
                      {{else if (eq annotation.type 'comment')}}
                        <div class='comment-text'>{{annotation.text}}</div>
                      {{/if}}
                    </div>
                    <div class='note-meta'>
                      <span class='note-date'>{{formatDateTime
                          annotation.createdAt
                          relative=true
                        }}</span>
                    </div>
                  </div>
                {{/each}}
              </div>
            {{else}}
              <div class='empty-notes'>
                <div class='empty-icon'>
                  <svg
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <path
                      d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'
                    />
                    <polyline points='14,2 14,8 20,8' />
                  </svg>
                </div>
                <p class='empty-message'>No highlights on page
                  {{this.currentPage}}
                  yet.</p>
                <div class='annotation-tips'>
                  <h4>How to annotate:</h4>
                  <ul>
                    <li><strong>Highlight:</strong>
                      Select text to automatically highlight it</li>
                    <li><strong>Drawing:</strong>
                      Click drawing tool and draw on the document</li>
                  </ul>
                </div>
              </div>
            {{/if}}
          </div>
        {{/if}}
      </main>
    </div>

    <style scoped>
      /* ⁸ Annotation styling - Enhanced PDF-like interface */
      .annotation-isolated {
        font-family:
          'Inter',
          -apple-system,
          BlinkMacSystemFont,
          sans-serif;
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        background: #f1f3f4;
        overflow: hidden;
      }

      /* Modern Professional Header */
      .modern-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.75rem 1rem;
        background: linear-gradient(
          135deg,
          #1e293b 0%,
          #334155 50%,
          #475569 100%
        );
        color: white;
        box-shadow:
          0 4px 20px rgba(0, 0, 0, 0.15),
          0 1px 3px rgba(0, 0, 0, 0.1);
        position: relative;
        overflow: hidden;
      }

      .modern-header::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 1px;
        background: linear-gradient(
          90deg,
          transparent,
          rgba(255, 255, 255, 0.2),
          transparent
        );
      }

      .header-left {
        display: flex;
        align-items: center;
      }

      .app-branding {
        display: flex;
        align-items: center;
        gap: 0.75rem;
      }

      .app-icon {
        width: 2rem;
        height: 2rem;
        background: linear-gradient(135deg, #f59e0b, #d97706);
        border-radius: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 4px 12px rgba(245, 158, 11, 0.3);
      }

      .app-icon svg {
        width: 1.125rem;
        height: 1.125rem;
        color: white;
      }

      .app-title {
        font-size: 1rem;
        font-weight: 700;
        margin: 0;
        letter-spacing: -0.025em;
      }

      .app-subtitle {
        font-size: 0.6875rem;
        color: rgba(255, 255, 255, 0.8);
        font-weight: 500;
        margin-top: 0.0625rem;
      }

      .header-center {
        flex: 1;
        display: flex;
        justify-content: center;
        max-width: 32rem;
      }

      .document-info-modern {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        background: rgba(255, 255, 255, 0.1);
        padding: 0.5rem 0.75rem;
        border-radius: 8px;
        backdrop-filter: blur(8px);
        border: 1px solid rgba(255, 255, 255, 0.15);
      }

      .doc-icon {
        width: 1.5rem;
        height: 1.5rem;
        color: #60a5fa;
        flex-shrink: 0;
      }

      .doc-title {
        font-size: 0.875rem;
        font-weight: 600;
        margin: 0;
        color: white;
        line-height: 1.2;
      }

      .doc-meta {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        font-size: 0.6875rem;
        color: rgba(255, 255, 255, 0.8);
        margin-top: 0.125rem;
      }

      .annotation-count {
        font-weight: 500;
      }

      .separator {
        opacity: 0.5;
      }

      .page-indicator {
        font-weight: 500;
      }

      .header-right {
        display: flex;
        align-items: center;
      }

      .quick-actions {
        display: flex;
        gap: 0.5rem;
      }

      .header-action {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 2.25rem;
        height: 2.25rem;
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 6px;
        color: white;
        cursor: pointer;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        position: relative;
        overflow: hidden;
      }

      .header-action::before {
        content: '';
        position: absolute;
        top: 0;
        left: -100%;
        width: 100%;
        height: 100%;
        background: linear-gradient(
          90deg,
          transparent,
          rgba(255, 255, 255, 0.2),
          transparent
        );
        transition: left 0.5s;
      }

      .header-action:hover::before {
        left: 100%;
      }

      .header-action svg {
        width: 1rem;
        height: 1rem;
      }

      .header-action:hover {
        background: rgba(255, 255, 255, 0.2);
        border-color: rgba(255, 255, 255, 0.3);
        transform: translateY(-2px);
        box-shadow: 0 8px 25px rgba(0, 0, 0, 0.15);
      }

      .header-action.active {
        background: linear-gradient(135deg, #3b82f6, #1d4ed8);
        border-color: #3b82f6;
        box-shadow: 0 4px 20px rgba(59, 130, 246, 0.4);
      }

      .header-action {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        padding: 0.5rem 0.75rem;
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 6px;
        color: white;
        cursor: pointer;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        position: relative;
        overflow: hidden;
        font-size: 0.75rem;
        font-weight: 500;
        white-space: nowrap;
      }

      /* Clean Minimalist Toolbar */
      .clean-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.5rem 0.75rem;
        background: linear-gradient(to bottom, #ffffff 0%, #fafbfc 100%);
        border-bottom: 1px solid #e5e7eb;
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
        position: relative;
        min-height: 2.5rem;
      }

      .toolbar-primary {
        display: flex;
        align-items: center;
        gap: 1.5rem;
        flex: 1;
      }

      .tool-cluster {
        display: flex;
        gap: 0.125rem;
        background: #f8fafc;
        padding: 0.25rem;
        border-radius: 8px;
        border: 1px solid #e5e7eb;
      }

      .clean-tool-btn {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 0.75rem;
        background: transparent;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.2s ease;
        position: relative;
        color: #64748b;
        font-size: 0.75rem;
        font-weight: 500;
      }

      .clean-tool-btn:hover {
        background: rgba(59, 130, 246, 0.08);
        color: #3b82f6;
        transform: translateY(-1px);
      }

      .clean-tool-btn.active {
        background: #3b82f6;
        color: white;
        box-shadow: 0 2px 8px rgba(59, 130, 246, 0.25);
      }

      .clean-tool-btn .tool-icon {
        width: 1rem;
        height: 1rem;
        transition: transform 0.2s;
      }

      .clean-tool-btn:hover .tool-icon {
        transform: scale(1.05);
      }

      .tool-label {
        font-weight: 500;
        letter-spacing: -0.01em;
      }

      .tool-options {
        display: flex;
        align-items: center;
      }

      .color-strip {
        display: flex;
        gap: 0.375rem;
        padding: 0.25rem;
        background: white;
        border-radius: 8px;
        border: 1px solid #e5e7eb;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
      }

      .color-chip {
        width: 1.5rem;
        height: 1.5rem;
        border: 2px solid transparent;
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.2s ease;
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
      }

      .color-chip:hover {
        transform: scale(1.1);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      }

      .color-chip.selected {
        border-color: #1f2937;
        transform: scale(1.15);
        box-shadow:
          0 0 0 2px #1f2937,
          0 4px 16px rgba(0, 0, 0, 0.2);
      }

      .check-mark {
        width: 0.875rem;
        height: 0.875rem;
        color: rgba(0, 0, 0, 0.7);
      }

      .thickness-strip {
        display: flex;
        gap: 0.25rem;
        padding: 0.25rem;
        background: white;
        border-radius: 8px;
        border: 1px solid #e5e7eb;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
      }

      .thickness-chip {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 2rem;
        height: 2rem;
        background: transparent;
        border: 1px solid transparent;
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .thickness-chip:hover {
        background: #f8fafc;
        border-color: #cbd5e1;
      }

      .thickness-chip.active {
        background: #3b82f6;
        border-color: #3b82f6;
        box-shadow: 0 2px 8px rgba(59, 130, 246, 0.25);
      }

      .thickness-preview {
        background: #64748b;
        border-radius: 50%;
        transition: background 0.2s;
      }

      .thickness-chip.active .thickness-preview {
        background: white;
      }

      .toolbar-selection {
        display: flex;
        align-items: center;
        gap: 1rem;
        background: linear-gradient(135deg, #ecfdf5, #d1fae5);
        border: 1px solid #86efac;
        border-radius: 8px;
        padding: 0.5rem 0.75rem;
        margin: 0 1rem;
        flex: 1;
        max-width: 28rem;
      }

      .selection-preview {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        flex: 1;
        min-width: 0;
      }

      .text-icon {
        width: 1rem;
        height: 1rem;
        color: #059669;
        flex-shrink: 0;
      }

      .selected-text-preview {
        font-size: 0.75rem;
        color: #065f46;
        font-weight: 500;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-style: italic;
      }

      .quick-actions {
        display: flex;
        gap: 0.375rem;
      }

      .quick-btn {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        padding: 0.375rem 0.5rem;
        border: none;
        border-radius: 6px;
        font-size: 0.6875rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .quick-btn svg {
        width: 0.75rem;
        height: 0.75rem;
      }

      .highlight-quick {
        background: #f59e0b;
        color: white;
        box-shadow: 0 2px 6px rgba(245, 158, 11, 0.25);
      }

      .highlight-quick:hover {
        background: #d97706;
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(245, 158, 11, 0.35);
      }

      .note-quick {
        background: #3b82f6;
        color: white;
        box-shadow: 0 2px 6px rgba(59, 130, 246, 0.25);
      }

      .note-quick:hover {
        background: #2563eb;
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(59, 130, 246, 0.35);
      }

      .comment-quick {
        background: #10b981;
        color: white;
        box-shadow: 0 2px 6px rgba(16, 185, 129, 0.25);
      }

      .comment-quick:hover {
        background: #059669;
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(16, 185, 129, 0.35);
      }

      .clear-quick {
        background: #6b7280;
        color: white;
        box-shadow: 0 2px 6px rgba(107, 114, 128, 0.25);
      }

      .clear-quick:hover {
        background: #4b5563;
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(107, 114, 128, 0.35);
      }

      .toolbar-secondary {
        display: flex;
        align-items: center;
      }

      .secondary-btn {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        padding: 0.375rem 0.5rem;
        background: white;
        border: 1px solid #e5e7eb;
        border-radius: 6px;
        font-size: 0.6875rem;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
        color: #64748b;
      }

      .secondary-btn svg {
        width: 0.75rem;
        height: 0.75rem;
      }

      .clear-all-btn:hover {
        background: #fef2f2;
        border-color: #fca5a5;
        color: #dc2626;
        transform: translateY(-1px);
        box-shadow: 0 2px 8px rgba(220, 38, 38, 0.15);
      }

      .clear-current-button {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 0.75rem;
        background: #f97316;
        color: white;
        border: none;
        border-radius: 6px;
        font-size: 0.8125rem;
        cursor: pointer;
        transition: all 0.2s;
      }

      .clear-current-button:hover {
        background: #ea580c;
      }

      .export-button svg,
      .clear-button svg {
        width: 0.625rem;
        height: 0.625rem;
      }

      .selection-actions {
        display: flex;
        gap: 0.375rem;
        padding: 0.25rem;
        background: linear-gradient(
          135deg,
          rgba(255, 255, 255, 0.95),
          rgba(248, 250, 252, 0.95)
        );
        border-radius: 8px;
        border: 1px solid rgba(0, 0, 0, 0.1);
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
        backdrop-filter: blur(8px);
      }

      .highlight-selection-btn,
      .note-selection-btn,
      .clear-selection-btn {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        padding: 0.25rem 0.5rem;
        border: none;
        border-radius: 5px;
        font-size: 0.625rem;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        position: relative;
        overflow: hidden;
      }

      .highlight-selection-btn::before,
      .note-selection-btn::before,
      .clear-selection-btn::before {
        content: '';
        position: absolute;
        top: 0;
        left: -100%;
        width: 100%;
        height: 100%;
        background: linear-gradient(
          90deg,
          transparent,
          rgba(255, 255, 255, 0.3),
          transparent
        );
        transition: left 0.5s;
      }

      .highlight-selection-btn:hover::before,
      .note-selection-btn:hover::before,
      .clear-selection-btn:hover::before {
        left: 100%;
      }

      .highlight-selection-btn {
        background: linear-gradient(135deg, #f59e0b, #d97706);
        color: white;
        box-shadow: 0 2px 8px rgba(245, 158, 11, 0.3);
      }

      .highlight-selection-btn:hover {
        background: linear-gradient(135deg, #d97706, #b45309);
        transform: translateY(-2px);
        box-shadow: 0 4px 16px rgba(245, 158, 11, 0.4);
      }

      .note-selection-btn {
        background: linear-gradient(135deg, #3b82f6, #2563eb);
        color: white;
        box-shadow: 0 2px 8px rgba(59, 130, 246, 0.3);
      }

      .note-selection-btn:hover {
        background: linear-gradient(135deg, #2563eb, #1d4ed8);
        transform: translateY(-2px);
        box-shadow: 0 4px 16px rgba(59, 130, 246, 0.4);
      }

      .clear-selection-btn {
        background: linear-gradient(135deg, #6b7280, #4b5563);
        color: white;
        box-shadow: 0 2px 8px rgba(107, 114, 128, 0.3);
      }

      .clear-selection-btn:hover {
        background: linear-gradient(135deg, #4b5563, #374151);
        transform: translateY(-2px);
        box-shadow: 0 4px 16px rgba(107, 114, 128, 0.4);
      }

      .highlight-selection-btn svg,
      .note-selection-btn svg,
      .clear-selection-btn svg {
        width: 0.625rem;
        height: 0.625rem;
      }

      .thickness-controls {
        display: flex;
        gap: 0.125rem;
      }

      .thickness-btn {
        width: 1.5rem;
        height: 1.5rem;
        border: 1px solid #d1d5db;
        border-radius: 3px;
        background: white;
        cursor: pointer;
        font-size: 0.625rem;
        font-weight: 500;
        transition: all 0.2s;
      }

      .thickness-btn:hover {
        background: #f3f4f6;
        border-color: #9ca3af;
      }

      .thickness-btn.active {
        background: #3b82f6;
        color: white;
        border-color: #3b82f6;
      }

      .annotation-content {
        flex: 1;
        display: flex;
        overflow: hidden;
      }

      .document-viewer {
        flex: 1;
        background: #f3f4f6;
        overflow-y: auto;
        width: 100%;
      }

      .pdf-viewer {
        height: 100%;
        display: flex;
        flex-direction: column;
        width: 100%;
      }

      .pdf-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0.25rem 0.5rem;
        background: white;
        border-bottom: 1px solid #e5e7eb;
      }

      .pdf-title {
        font-size: 0.75rem;
        font-weight: 500;
        color: #1f2937;
      }

      .pdf-controls {
        display: flex;
        align-items: center;
        gap: 1rem;
      }

      .page-controls {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }

      .zoom-controls {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        padding: 0.125rem;
        background: #f8f9fa;
        border-radius: 6px;
        border: 1px solid #e5e7eb;
      }

      .control-button {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        padding: 0.25rem 0.5rem;
        background: white;
        border: 1px solid #d1d5db;
        border-radius: 4px;
        font-size: 0.625rem;
        cursor: pointer;
        transition: all 0.2s;
        font-weight: 500;
      }

      .control-button svg {
        width: 0.75rem;
        height: 0.75rem;
      }

      .control-button:hover:not(:disabled) {
        background: #f3f4f6;
        border-color: #9ca3af;
        transform: translateY(-1px);
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
      }

      .control-button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .zoom-button {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 2rem;
        height: 2rem;
        padding: 0.25rem;
        background: white;
        border: 1px solid #d1d5db;
        border-radius: 4px;
        cursor: pointer;
        transition: all 0.2s;
      }

      .zoom-button svg {
        width: 0.875rem;
        height: 0.875rem;
      }

      .zoom-button:hover:not(:disabled) {
        background: #3b82f6;
        color: white;
        border-color: #3b82f6;
        transform: scale(1.05);
      }

      .zoom-button:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }

      .zoom-button.fit-width:hover {
        background: #10b981;
        border-color: #10b981;
      }

      .zoom-button.reset:hover {
        background: #6b7280;
        border-color: #6b7280;
      }

      .zoom-level {
        font-size: 0.625rem;
        font-weight: 600;
        color: #4b5563;
        min-width: 2.5rem;
        text-align: center;
        padding: 0 0.25rem;
      }

      .page-info {
        font-size: 0.625rem;
        color: #6b7280;
        font-weight: 500;
        white-space: nowrap;
      }

      .pdf-content {
        flex: 1;
        padding: 0.375rem;
        overflow-y: auto;
        background: radial-gradient(
          ellipse at center,
          #f8f9fa 0%,
          #e9ecef 100%
        );
        display: flex;
        justify-content: center;
        align-items: flex-start;
        width: 100%;
      }

      .canvas-container {
        position: relative;
        background: white;
        border-radius: 12px;
        box-shadow:
          0 10px 25px rgba(0, 0, 0, 0.15),
          0 5px 10px rgba(0, 0, 0, 0.08),
          inset 0 1px 0 rgba(255, 255, 255, 0.8);
        user-select: text;
        width: 100%;
        display: flex;
        justify-content: center;
        border: 1px solid rgba(0, 0, 0, 0.08);
        overflow: hidden;
      }

      .canvas-container::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 1px;
        background: linear-gradient(
          90deg,
          transparent,
          rgba(255, 255, 255, 0.8),
          transparent
        );
        z-index: 1;
      }

      .textLayer {
        position: absolute;
        top: 0;
        left: 0;
        overflow: hidden;
        pointer-events: auto !important;
        user-select: text !important;
        z-index: 20; /* above canvas */
      }

      /* ¹⁰⁹ Enhanced drawing mode isolation with event boundaries */
      .pageLayer {
        isolation: isolate; /* Prevent event propagation from external elements */
      }

      .canvas-container[data-drawing-mode='true'] .textLayer {
        pointer-events: none !important;
        user-select: none !important;
        z-index: 15 !important; /* Lower than drawing layer */
      }

      /* ¹¹⁰ Drawing layer with event isolation */
      .drawing-layer {
        position: relative;
        z-index: 20;
        isolation: isolate; /* Prevent external events from interfering */
      }

      .canvas-container[data-drawing-mode='true'] .drawing-layer {
        z-index: 30; /* Highest when drawing active */
        cursor: crosshair;
        contain: layout style; /* ¹¹¹ Further isolate drawing mode events */
      }

      /* ¹¹⁸ CRITICAL: Completely disable text selection when drawing mode is active */
      .canvas-container[data-drawing-mode='true'] {
        user-select: none !important;
        -webkit-user-select: none !important;
        -moz-user-select: none !important;
        -ms-user-select: none !important;
      }

      .canvas-container[data-drawing-mode='true'] * {
        user-select: none !important;
        -webkit-user-select: none !important;
        -moz-user-select: none !important;
        -ms-user-select: none !important;
        pointer-events: none !important;
      }

      .canvas-container[data-drawing-mode='true'] .drawing-layer {
        pointer-events: auto !important; /* Re-enable only for drawing layer */
      }

      .canvas-container[data-drawing-mode='true'] .drawing-layer * {
        pointer-events: auto !important; /* Re-enable for drawing children */
      }

      /* ¹⁰⁹ Drawing overlay canvas styling with event isolation */
      .drawing-overlay {
        position: absolute !important;
        top: 0 !important;
        left: 0 !important;
        pointer-events: none !important;
        z-index: 25 !important;
      }

      .drawing-preview {
        position: absolute !important;
        top: 0 !important;
        left: 0 !important;
        pointer-events: none !important;
        z-index: 30 !important;
      }

      /* ¹¹⁰ CSS containment for drawing mode to isolate events */
      .canvas-container[data-drawing-mode='true'] {
        isolation: isolate;
      }

      .canvas-container[data-drawing-mode='true'] .drawing-layer {
        contain: layout style;
      }

      /* ¹¹¹ Isolate pageLayer events from external interference */
      .pageLayer {
        isolation: isolate;
      }

      .textLayer span {
        /* ²³ Complete invisibility - based on PDF.js best practices */
        color: transparent !important;
        background: transparent !important;
        cursor: text !important;
        user-select: text !important;
        pointer-events: auto !important;

        /* CRITICAL: Remove all PDF.js default styling that could cause visual artifacts */
        border: none !important;
        outline: none !important;
        text-shadow: none !important;
        text-decoration: none !important;
        box-shadow: none !important;

        /* Force invisible rendering */
        opacity: 0 !important;
        visibility: visible !important; /* Keep visible for selection to work */

        /* Prevent font rendering artifacts */
        font-size: 1px !important; /* Minimal font size to prevent text showing */
        line-height: 1 !important;
        font-family: monospace !important; /* Consistent character width */
        font-weight: normal !important;
        font-style: normal !important;

        /* Reset positioning to prevent displacement */
        transform: none !important;
        position: absolute !important;
        white-space: nowrap !important;

        /* Disable any hover/focus effects */
        transition: none !important;
      }

      .textLayer span::selection {
        /* ²⁴ Visible selection highlighting */
        background: rgba(0, 123, 255, 0.3) !important;
        color: transparent !important; /* Keep text transparent even when selected */
      }

      .textLayer span::-moz-selection {
        /* Firefox compatibility */
        background: rgba(0, 123, 255, 0.3) !important;
        color: transparent !important;
      }

      .pdf-canvas {
        display: block;
        width: 100%;
        height: auto;
        border-radius: 8px;
        max-width: 100%;
        z-index: 1; /* Canvas shows glyphs, text layer invisible above */
        position: relative;
        max-width: 100%;
        height: auto;
        border: 1px solid #e5e7eb;
      }

      .error-message {
        display: flex;
        align-items: flex-start;
        gap: 0.75rem;
        padding: 2rem;
        background: #fef2f2;
        border: 1px solid #fecaca;
        border-radius: 8px;
        color: #dc2626;
        margin: 1rem;
      }

      .error-icon {
        width: 1.5rem;
        height: 1.5rem;
        flex-shrink: 0;
        margin-top: 0.125rem;
      }

      .error-content {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        width: 100%;
      }

      .error-text {
        font-size: 0.875rem;
        line-height: 1.5;
      }

      .retry-button {
        background: #dc2626;
        color: white;
        border: none;
        padding: 0.5rem 1rem;
        border-radius: 6px;
        font-size: 0.875rem;
        cursor: pointer;
        align-self: flex-start;
      }

      .retry-button:hover {
        background: #b91c1c;
      }

      .loading-pdf {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 3rem;
        gap: 1rem;
      }

      .loading-icon {
        width: 2rem;
        height: 2rem;
        color: #3b82f6;
        animation: spin 1s linear infinite;
      }

      @keyframes spin {
        from {
          transform: rotate(0deg);
        }
        to {
          transform: rotate(360deg);
        }
      }

      .loading-text {
        font-size: 0.875rem;
        color: #6b7280;
      }

      /* ²² Note dialog styling */
      .note-dialog {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(0, 0, 0, 0.5);
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
      }

      .note-dialog-content {
        background: white;
        border-radius: 12px;
        padding: 2rem;
        width: 90%;
        max-width: 32rem;
        box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
      }

      .note-dialog-content h4 {
        margin: 0 0 1rem 0;
        font-size: 1.125rem;
        font-weight: 600;
        color: #1f2937;
      }

      .selected-text {
        background: #f3f4f6;
        padding: 0.75rem;
        border-radius: 6px;
        margin-bottom: 1rem;
        font-size: 0.875rem;
        color: #374151;
      }

      .note-input {
        width: 100%;
        min-height: 8rem;
        padding: 0.75rem;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        font-size: 0.875rem;
        font-family: inherit;
        resize: vertical;
        margin-bottom: 1rem;
      }

      .note-input:focus {
        outline: none;
        border-color: #3b82f6;
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
      }

      .note-actions {
        display: flex;
        gap: 0.75rem;
        justify-content: flex-end;
      }

      .save-note-btn {
        background: #3b82f6;
        color: white;
        border: none;
        padding: 0.5rem 1rem;
        border-radius: 6px;
        font-size: 0.875rem;
        cursor: pointer;
      }

      .cancel-note-btn {
        background: #f3f4f6;
        color: #6b7280;
        border: 1px solid #d1d5db;
        padding: 0.5rem 1rem;
        border-radius: 6px;
        font-size: 0.875rem;
        cursor: pointer;
      }

      .document-page {
        max-width: 48rem;
        margin: 0 auto;
        background: white;
        padding: 3rem;
        border-radius: 8px;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        line-height: 1.7;
      }

      .document-page h3 {
        font-size: 1.5rem;
        font-weight: 600;
        color: #1f2937;
        margin-bottom: 2rem;
      }

      .document-page p {
        margin-bottom: 1.5rem;
        color: #374151;
      }

      .highlight {
        padding: 0.125rem 0.25rem;
        border-radius: 3px;
        font-weight: 500;
      }

      .highlight.yellow {
        background: rgba(255, 235, 59, 0.5);
      }

      .highlight.green {
        background: rgba(76, 175, 80, 0.5);
      }

      .highlight.blue {
        background: rgba(33, 150, 243, 0.5);
      }

      .annotation-note {
        display: flex;
        align-items: flex-start;
        gap: 0.75rem;
        background: #fef3c7;
        border-left: 4px solid #f59e0b;
        padding: 1rem;
        border-radius: 6px;
        margin: 2rem 0;
      }

      .note-icon {
        width: 1.25rem;
        height: 1.25rem;
        color: #f59e0b;
        flex-shrink: 0;
        margin-top: 0.125rem;
      }

      .no-document {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        padding: 3rem;
      }

      .upload-icon {
        width: 4rem;
        height: 4rem;
        color: #d1d5db;
        margin-bottom: 2rem;
      }

      .upload-content {
        text-align: center;
      }

      .upload-title {
        font-size: 1.25rem;
        font-weight: 600;
        color: #1f2937;
        margin: 0 0 0.5rem 0;
      }

      .upload-subtitle {
        font-size: 0.875rem;
        color: #6b7280;
        margin: 0 0 2rem 0;
      }

      .upload-button {
        background: #3b82f6;
        color: white;
        border: none;
        padding: 0.75rem 1.5rem;
        border-radius: 8px;
        font-size: 0.875rem;
        cursor: pointer;
      }

      .hidden-input {
        display: none;
      }

      .load-pdf {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        padding: 3rem;
      }

      .load-icon {
        width: 4rem;
        height: 4rem;
        color: #f59e0b;
        margin-bottom: 2rem;
      }

      .load-content {
        text-align: center;
      }

      .load-title {
        font-size: 1.25rem;
        font-weight: 600;
        color: #1f2937;
        margin: 0 0 0.5rem 0;
      }

      .load-subtitle {
        font-size: 0.875rem;
        color: #6b7280;
        margin: 0 0 2rem 0;
      }

      .load-button {
        background: #f59e0b;
        color: white;
        border: none;
        padding: 0.75rem 1.5rem;
        border-radius: 8px;
        font-size: 0.875rem;
        cursor: pointer;
        transition: background 0.2s;
      }

      .load-button:hover:not(:disabled) {
        background: #d97706;
      }

      .load-button:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      .notes-panel {
        width: 14rem;
        background: linear-gradient(to bottom, #ffffff, #fafbfc);
        border-left: 1px solid #e5e7eb;
        overflow-y: auto;
        box-shadow: inset 4px 0 8px rgba(0, 0, 0, 0.05);
      }

      .notes-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0.375rem;
        border-bottom: 1px solid #e5e7eb;
        background: linear-gradient(135deg, #f8f9fa, #ffffff);
        position: sticky;
        top: 0;
        z-index: 10;
      }

      .notes-header h3 {
        font-size: 0.75rem;
        font-weight: 600;
        color: #1f2937;
        margin: 0;
      }

      .add-note-button {
        display: flex;
        align-items: center;
        gap: 0.125rem;
        padding: 0.1875rem 0.375rem;
        background: #3b82f6;
        color: white;
        border: none;
        border-radius: 3px;
        font-size: 0.625rem;
        cursor: pointer;
      }

      .add-note-button svg {
        width: 0.625rem;
        height: 0.625rem;
      }

      .notes-list {
        padding: 0.375rem;
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
      }

      .note-item {
        padding: 0.375rem;
        background: linear-gradient(135deg, #ffffff, #f8f9fa);
        border-radius: 5px;
        border: 1px solid #e5e7eb;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
        transition: all 0.2s ease;
        position: relative;
        overflow: hidden;
      }

      .note-item::before {
        content: '';
        position: absolute;
        left: 0;
        top: 0;
        bottom: 0;
        width: 4px;
        background: linear-gradient(180deg, #3b82f6, #8b5cf6);
      }

      .note-item:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
      }

      .note-item .note-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 0.25rem;
        gap: 0.5rem;
      }

      .note-type {
        font-size: 0.625rem;
        font-weight: 500;
        color: #3b82f6;
        text-transform: capitalize;
      }

      .note-page {
        font-size: 0.625rem;
        color: #6b7280;
        flex: 1;
      }

      .annotation-color {
        width: 0.75rem;
        height: 0.75rem;
        border-radius: 2px;
        border: 1px solid rgba(0, 0, 0, 0.1);
        flex-shrink: 0;
      }

      .note-content {
        font-size: 0.6875rem;
        color: #374151;
        line-height: 1.4;
        margin-bottom: 0.25rem;
      }

      .note-meta {
        display: flex;
        justify-content: flex-end;
      }

      .note-date {
        font-size: 0.5625rem;
        color: #9ca3af;
      }

      .empty-notes {
        padding: 3rem 1.5rem;
        text-align: center;
        color: #6b7280;
      }

      .empty-notes p {
        font-size: 0.875rem;
        line-height: 1.6;
      }

      .annotation-tips {
        margin-top: 1.5rem;
        padding: 1rem;
        background: #f8fafc;
        border-radius: 6px;
        border: 1px solid #e2e8f0;
      }

      .annotation-tips h4 {
        font-size: 0.875rem;
        font-weight: 600;
        color: #1f2937;
        margin: 0 0 0.75rem 0;
      }

      .annotation-tips ul {
        margin: 0;
        padding-left: 1.25rem;
      }

      .annotation-tips li {
        font-size: 0.8125rem;
        color: #4b5563;
        margin-bottom: 0.5rem;
        line-height: 1.4;
      }

      .annotation-tips li:last-child {
        margin-bottom: 0;
      }

      /* Enhanced note item styling */
      .highlight-content {
        display: flex;
        align-items: flex-start;
        gap: 0.5rem;
      }

      .highlight-color {
        width: 0.75rem;
        height: 0.75rem;
        border-radius: 3px;
        flex-shrink: 0;
        margin-top: 0.125rem;
        border: 1px solid rgba(0, 0, 0, 0.1);
      }

      .highlight-text {
        flex: 1;
        font-size: 0.6875rem;
        color: #374151;
        line-height: 1.4;
        font-style: italic;
      }

      .note-text,
      .comment-text {
        font-size: 0.6875rem;
        color: #374151;
        line-height: 1.4;
      }

      .drawing-indicator {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        font-size: 0.6875rem;
        color: #6b7280;
        font-style: italic;
      }

      .drawing-indicator svg {
        width: 0.875rem;
        height: 0.875rem;
        color: #3b82f6;
      }

      .empty-notes {
        padding: 2rem 1rem;
        text-align: center;
        color: #6b7280;
      }

      .empty-icon {
        width: 2rem;
        height: 2rem;
        color: #d1d5db;
        margin: 0 auto 1rem;
      }

      .empty-message {
        font-size: 0.875rem;
        color: #6b7280;
        margin-bottom: 1.5rem;
      }
    </style>
  </template>
}

export class AnnotationCard extends CardDef {
  // ³ Annotation card definition
  static displayName = 'Document Annotation';
  static icon = EditIcon;

  @field documentUrl = contains(UrlField); // ⁴ Document and annotation fields
  @field documentTitle = contains(StringField);
  @field annotations = containsMany(StringField); // Legacy field for backward compatibility
  @field pageNumber = contains(NumberField);
  @field position = contains(StringField);
  @field annotationType = contains(StringField);
  @field color = contains(StringField);
  @field createdAt = contains(StringField); // Store as ISO string for compatibility

  // New structured annotation fields
  @field annotationData = contains(StringField); // JSON string containing all annotations

  // ⁵ Computed title
  @field title = contains(StringField, {
    computeVia: function (this: AnnotationCard) {
      try {
        const docTitle = this.documentTitle || 'Document';
        const annotationCount = this.annotations?.length || 0;
        return `${docTitle} (${annotationCount} annotations)`;
      } catch (e) {
        console.error('AnnotationCard: Error computing title', e);
        return 'Document Annotations';
      }
    },
  });

  static isolated = AnnotationIsolated;

  static embedded = class Embedded extends Component<typeof AnnotationCard> {
    // ⁹ Embedded format
    <template>
      <div class='annotation-embedded'>
        <div class='annotation-summary'>
          <div class='doc-header'>
            <h4 class='doc-title'>{{if
                @model.documentTitle
                @model.documentTitle
                'Document Annotations'
              }}</h4>
            <div class='doc-stats'>
              <span class='stat'>{{if
                  @model.annotations
                  @model.annotations.length
                  0
                }}
                annotations</span>
            </div>
          </div>

        </div>
      </div>

      <style scoped>
        /* ¹⁰ Embedded styling */
        .annotation-embedded {
          font-family: 'Inter', sans-serif;
          padding: 1rem;
          background: white;
          border-radius: 8px;
          border: 1px solid #e5e7eb;
          font-size: 0.8125rem;
        }

        .doc-header {
          margin-bottom: 1rem;
        }

        .doc-title {
          font-size: 0.875rem;
          font-weight: 600;
          color: #1f2937;
          margin: 0 0 0.5rem 0;
        }

        .doc-stats {
          display: flex;
          gap: 1rem;
        }

        .stat {
          font-size: 0.75rem;
          color: #6b7280;
        }

        .notes-title {
          font-size: 0.75rem;
          font-weight: 500;
          color: #6b7280;
          margin: 0 0 0.75rem 0;
        }

        .notes-preview {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }

        .note-preview {
          padding: 0.75rem;
          background: #f9fafb;
          border-radius: 6px;
          border-left: 3px solid #3b82f6;
        }

        .note-text {
          font-size: 0.75rem;
          color: #374151;
          line-height: 1.5;
          margin-bottom: 0.375rem;
        }

        .note-time {
          font-size: 0.6875rem;
          color: #9ca3af;
        }

        .no-notes {
          padding: 2rem 1rem;
          text-align: center;
          color: #6b7280;
        }

        .no-notes p {
          font-size: 0.8125rem;
          margin: 0;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof AnnotationCard> {
    // ¹¹ Fitted format
    <template>
      <div class='fitted-container'>
        <div class='badge-format'>
          <div class='annotation-badge'>
            <svg
              class='badge-icon'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <path d='M12 20h9' />
              <path
                d='M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z'
              />
            </svg>
            <div class='badge-content'>
              <div class='badge-title'>Annotations</div>

            </div>
          </div>
        </div>

        <div class='strip-format'>
          <div class='annotation-strip'>
            <svg
              class='strip-icon'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <path d='M12 20h9' />
              <path
                d='M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z'
              />
            </svg>
            <span class='strip-title'>{{if
                @model.documentTitle
                @model.documentTitle
                'Document'
              }}</span>
            <div class='strip-stats'>
              <span>{{if @model.annotations @model.annotations.length 0}}
                marks</span>
              <span>{{if @model.annotations @model.annotations.length 0}}
                annotations</span>
            </div>
          </div>
        </div>

        <div class='tile-format'>
          <div class='annotation-tile'>
            <div class='tile-header'>
              <h3 class='tile-title'>{{if
                  @model.documentTitle
                  @model.documentTitle
                  'Document Annotations'
                }}</h3>
              <svg
                class='tile-icon'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <path d='M12 20h9' />
                <path
                  d='M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z'
                />
              </svg>
            </div>
            <div class='tile-stats'>
              <div class='stat'>
                <span class='stat-value'>{{if
                    @model.annotations
                    @model.annotations.length
                    0
                  }}</span>
                <span class='stat-label'>annotations</span>
              </div>
            </div>
          </div>
        </div>

        <div class='card-format'>
          <div class='annotation-card'>
            <div class='card-header'>
              <h3 class='card-title'>{{if
                  @model.documentTitle
                  @model.documentTitle
                  'Document Annotations'
                }}</h3>
              <svg
                class='card-icon'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <path d='M12 20h9' />
                <path
                  d='M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z'
                />
              </svg>
            </div>
            <div class='card-stats'>
              <div class='stats-grid'>
                <div class='card-stat'>
                  <span class='stat-value'>{{if
                      @model.annotations
                      @model.annotations.length
                      0
                    }}</span>
                  <span class='stat-label'>Annotations</span>
                </div>
                <div class='card-stat'>
                  <span class='stat-value'>{{if
                      @model.pageNumber
                      @model.pageNumber
                      1
                    }}</span>
                  <span class='stat-label'>Pages</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <style scoped>
        /* ¹² Fitted styling */
        .fitted-container {
          container-type: size;
          width: 100%;
          height: 100%;
          font-family: 'Inter', sans-serif;
        }

        .badge-format,
        .strip-format,
        .tile-format,
        .card-format {
          display: none;
          width: 100%;
          height: 100%;
          padding: clamp(0.1875rem, 2%, 0.625rem);
          box-sizing: border-box;
        }

        @container (max-width: 150px) and (max-height: 169px) {
          .badge-format {
            display: flex;
          }
        }

        @container (min-width: 151px) and (max-height: 169px) {
          .strip-format {
            display: flex;
          }
        }

        @container (max-width: 399px) and (min-height: 170px) {
          .tile-format {
            display: flex;
            flex-direction: column;
          }
        }

        @container (min-width: 400px) and (min-height: 170px) {
          .card-format {
            display: flex;
            flex-direction: column;
          }
        }

        /* Badge Format */
        .annotation-badge {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          width: 100%;
          height: 100%;
          background: linear-gradient(135deg, #f59e0b, #d97706);
          color: white;
          border-radius: 6px;
          padding: 0.5rem;
          box-sizing: border-box;
        }

        .badge-icon {
          width: 1.25rem;
          height: 1.25rem;
          flex-shrink: 0;
        }

        .badge-title {
          font-size: 0.75rem;
          font-weight: 600;
          line-height: 1;
        }

        .badge-count {
          font-size: 0.625rem;
          opacity: 0.9;
          line-height: 1;
        }

        /* Strip Format */
        .annotation-strip {
          display: flex;
          justify-content: space-between;
          align-items: center;
          width: 100%;
          height: 100%;
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 6px;
          padding: 0.5rem 0.75rem;
          box-sizing: border-box;
        }

        .strip-icon {
          width: 1rem;
          height: 1rem;
          color: #f59e0b;
        }

        .strip-title {
          font-size: 0.8125rem;
          font-weight: 600;
          color: #1f2937;
          flex: 1;
          margin: 0 0.75rem;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .strip-stats {
          display: flex;
          gap: 0.5rem;
          font-size: 0.6875rem;
          color: #6b7280;
        }

        /* Tile Format */
        .annotation-tile {
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          width: 100%;
          height: 100%;
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          padding: 1rem;
          box-sizing: border-box;
        }

        .tile-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 0.75rem;
        }

        .tile-title {
          font-size: 0.875rem;
          font-weight: 600;
          color: #1f2937;
          margin: 0;
          line-height: 1.2;
          flex: 1;
        }

        .tile-icon {
          width: 1.25rem;
          height: 1.25rem;
          color: #f59e0b;
          flex-shrink: 0;
        }

        .tile-stats {
          display: flex;
          justify-content: space-between;
          margin-bottom: 0.75rem;
        }

        .stat {
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
        }

        .stat-value {
          font-size: 0.875rem;
          font-weight: 600;
          color: #1f2937;
          line-height: 1;
        }

        .stat-label {
          font-size: 0.625rem;
          color: #6b7280;
          margin-top: 0.125rem;
        }

        .recent-note {
          margin-top: auto;
          padding: 0.5rem;
          background: #fef3c7;
          border-radius: 4px;
          border-left: 3px solid #f59e0b;
        }

        .recent-note .note-text {
          font-size: 0.6875rem;
          color: #92400e;
          line-height: 1.4;
        }

        /* Card Format */
        .annotation-card {
          display: flex;
          flex-direction: column;
          width: 100%;
          height: 100%;
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          padding: 1.25rem;
          box-sizing: border-box;
        }

        .card-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 1rem;
        }

        .card-title {
          font-size: 1rem;
          font-weight: 600;
          color: #1f2937;
          margin: 0;
          line-height: 1.2;
          flex: 1;
        }

        .card-icon {
          width: 1.5rem;
          height: 1.5rem;
          color: #f59e0b;
          flex-shrink: 0;
        }

        .stats-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0.75rem;
          margin-bottom: 1rem;
        }

        .card-stat {
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
        }

        .card-stat .stat-value {
          font-size: 1rem;
          font-weight: 600;
          color: #1f2937;
          line-height: 1;
        }

        .card-stat .stat-label {
          font-size: 0.6875rem;
          color: #6b7280;
          margin-top: 0.25rem;
        }

        .notes-section {
          margin-top: auto;
        }

        .section-title {
          font-size: 0.75rem;
          font-weight: 500;
          color: #6b7280;
          margin-bottom: 0.5rem;
        }

        .notes-list {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .note-item {
          padding: 0.5rem;
          background: #f9fafb;
          border-radius: 4px;
          border-left: 3px solid #f59e0b;
        }

        .note-content {
          font-size: 0.6875rem;
          color: #374151;
          line-height: 1.4;
          margin-bottom: 0.25rem;
        }

        .note-date {
          font-size: 0.625rem;
          color: #9ca3af;
        }
      </style>
    </template>
  };
}
