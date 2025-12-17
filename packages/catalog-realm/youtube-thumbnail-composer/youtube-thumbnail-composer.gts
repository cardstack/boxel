// Glimmer and Ember
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { concat, fn } from '@ember/helper';
import { htmlSafe } from '@ember/template';

// Boxel UI Components
import {
  Button,
  FieldContainer,
  BoxelInput,
} from '@cardstack/boxel-ui/components';
import { eq, multiply } from '@cardstack/boxel-ui/helpers';
import { FourLines } from '@cardstack/boxel-ui/icons';
import {
  SortableGroupModifier as sortableGroup,
  SortableHandleModifier as sortableHandle,
  SortableItemModifier as sortableItem,
} from '@cardstack/boxel-ui/modifiers';

// Boxel Icons
import ImageIcon from '@cardstack/boxel-icons/image';
import TypeIcon from '@cardstack/boxel-icons/type';
import LayersIcon from '@cardstack/boxel-icons/layers';
import EyeIcon from '@cardstack/boxel-icons/eye';
import EyeOffIcon from '@cardstack/boxel-icons/eye-off';
import CopyIcon from '@cardstack/boxel-icons/copy';
import TrashIcon from '@cardstack/boxel-icons/trash-2';
import CheckIcon from '@cardstack/boxel-icons/check';

// Runtime Common
import { uuidv4 } from '@cardstack/runtime-common';

// Base Card API
import {
  CardDef,
  field,
  contains,
  containsMany,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import BooleanField from 'https://cardstack.com/base/boolean';

// Local imports
import { VisualElement } from './fields/visual-element';
import { TextElement } from './fields/text-element';
import { BackgroundElement } from './fields/background-element';
import { DragModifier } from './modifiers/draggable';

class Isolated extends Component<typeof YouTubeThumbnailComposer> {
  @tracked selectedElement: TextElement | VisualElement | null = null;
  @tracked activeTab = 'elements';
  @tracked editingElement: TextElement | null = null;
  @tracked tempEditContent = '';
  // Use a unique group name to avoid cross-instance sortable collisions
  private sortableGroupId = uuidv4();

  get aspectRatio() {
    return (this.args.model?.height ?? 720) / (this.args.model?.width ?? 1280);
  }

  get previewWidth() {
    const containerWidth = Math.min(700, window.innerWidth * 0.6);
    return containerWidth;
  }

  get previewHeight() {
    return this.previewWidth * this.aspectRatio;
  }

  get scaleRatio() {
    const width = this.args.model?.width ?? 1280;
    if (!width || width === 0) return 1;
    return this.previewWidth / width;
  }

  get isTextElement(): boolean {
    return this.selectedElement !== null && 'content' in this.selectedElement;
  }

  get selectedTextElement(): TextElement | null {
    return this.isTextElement ? (this.selectedElement as TextElement) : null;
  }
  get selectedVisualElement(): VisualElement | null {
    return this.selectedElement && !this.isTextElement
      ? (this.selectedElement as VisualElement)
      : null;
  }

  getTextWidth(element: TextElement): number {
    return element.width ?? 300;
  }

  getTextHeight(element: TextElement): number {
    return element.height ?? 100;
  }

  // Getters for text element properties with defaults
  get textFontSize() {
    return this.selectedTextElement?.fontSize ?? 48;
  }

  get textStrokeWidth() {
    return this.selectedTextElement?.strokeWidth ?? 0;
  }

  get textRotation() {
    return this.selectedTextElement?.rotation ?? 0;
  }

  get textOpacity() {
    return this.selectedTextElement?.opacity ?? 1;
  }

  get textLayer() {
    return this.selectedTextElement?.layer ?? 1;
  }

  // Getters for visual element properties with defaults
  get visualStrokeWidth() {
    return this.selectedVisualElement?.strokeWidth ?? 2;
  }

  get visualRotation() {
    return this.selectedVisualElement?.rotation ?? 0;
  }

  get visualOpacity() {
    return this.selectedVisualElement?.opacity ?? 1;
  }

  get visualLayer() {
    return this.selectedVisualElement?.layer ?? 1;
  }

  get backgroundStyle() {
    const bg = this.args.model?.background;
    if (!bg)
      return 'background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);';

    if (bg.type === 'solid') {
      return `background: ${bg.primaryColor || '#000'};`;
    } else if (bg.type === 'gradient') {
      const primary = bg.primaryColor || '#6366f1';
      const secondary = bg.secondaryColor || '#8b5cf6';
      const direction = bg.gradientDirection || 'to bottom right';
      return `background: linear-gradient(${direction}, ${primary}, ${secondary});`;
    } else if (bg.type === 'image') {
      // Prioritize manual override, then new wrapper field URL, then legacy link URL
      const imageUrl = bg.imageUrl || bg.image?.url || '';

      if (imageUrl) {
        const scale = bg.imageScale ?? 100;
        const posX = bg.imagePositionX ?? 50;
        const posY = bg.imagePositionY ?? 50;

        // Use auto sizing with scale factor - this gives better control over zoom
        const sizeValue = scale === 100 ? 'cover' : `${scale}% auto`;
        return `background-image: url(${imageUrl}); background-size: ${sizeValue}; background-position: ${posX}% ${posY}%; background-repeat: no-repeat;`;
      }
    }
    return 'background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);';
  }

  get allElements(): (TextElement | VisualElement)[] {
    const elements: (TextElement | VisualElement)[] = [];

    // Combine all elements
    if (this.args.model.textElements) {
      elements.push(...this.args.model.textElements);
    }
    if (this.args.model.visualElements) {
      elements.push(...this.args.model.visualElements);
    }

    // Sort by layer (z-index) - higher layer numbers appear first in the list (on top)
    return elements.sort((a, b) => (b.layer ?? 0) - (a.layer ?? 0));
  }

  @action
  selectElement(
    element: TextElement | VisualElement | null,
    event?: MouseEvent,
  ) {
    if (event) {
      event.stopPropagation();
    }
    this.selectedElement = element;
    // Only switch to properties tab if an element is selected
    if (element) {
      this.activeTab = 'properties';
    }
  }

  @action
  handleBackgroundDoubleClick(event: MouseEvent) {
    // Only switch to background tab if not clicking on an element
    const target = event.target as HTMLElement;
    if (
      target.classList.contains('thumbnail-preview') ||
      target.classList.contains('grid-overlay')
    ) {
      this.selectedElement = null;
      this.activeTab = 'background';
    }
  }

  @action
  toggleGrid() {
    this.args.model.showGrid = !this.args.model.showGrid;
  }

  @action
  async exportThumbnail() {
    const width = this.args.model?.width ?? 1280;
    const height = this.args.model?.height ?? 720;

    // Create a canvas element
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Draw background
    const bg = this.args.model?.background;
    if (bg?.type === 'solid') {
      ctx.fillStyle = bg.primaryColor || '#000';
      ctx.fillRect(0, 0, width, height);
    } else if (bg?.type === 'gradient') {
      const primary = bg.primaryColor || '#6366f1';
      const secondary = bg.secondaryColor || '#8b5cf6';
      const direction = bg.gradientDirection || 'to bottom right';

      // Map CSS-like directions to canvas gradient coordinates
      let x0 = 0;
      let y0 = 0;
      let x1 = width;
      let y1 = height;

      const dir = String(direction).toLowerCase().trim();
      if (dir.includes('to right')) {
        // left -> right
        x0 = 0;
        y0 = 0;
        x1 = width;
        y1 = 0;
      } else if (dir.includes('to left')) {
        // right -> left
        x0 = width;
        y0 = 0;
        x1 = 0;
        y1 = 0;
      } else if (dir.includes('to bottom')) {
        // top -> bottom
        x0 = 0;
        y0 = 0;
        x1 = 0;
        y1 = height;
      } else if (dir.includes('to top')) {
        // bottom -> top
        x0 = 0;
        y0 = height;
        x1 = 0;
        y1 = 0;
      } else if (dir.includes('45deg') || dir.includes('to top right')) {
        // bottom-left -> top-right
        x0 = 0;
        y0 = height;
        x1 = width;
        y1 = 0;
      } else if (
        dir.includes('135deg') ||
        dir.includes('to bottom right') ||
        dir.includes('to top left')
      ) {
        // top-left -> bottom-right (default)
        x0 = 0;
        y0 = 0;
        x1 = width;
        y1 = height;
      }

      const gradient = ctx.createLinearGradient(x0, y0, x1, y1);
      gradient.addColorStop(0, primary);
      gradient.addColorStop(1, secondary);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
    } else if (bg?.type === 'image') {
      const imageUrl = bg.imageUrl || bg.image?.url || '';
      if (imageUrl) {
        try {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = imageUrl;
          });

          const scale = (bg.imageScale ?? 100) / 100;
          const posX = (bg.imagePositionX ?? 50) / 100;
          const posY = (bg.imagePositionY ?? 50) / 100;

          const scaledWidth = width * scale;
          const scaledHeight = height * scale;
          const x = (width - scaledWidth) * posX;
          const y = (height - scaledHeight) * posY;

          ctx.drawImage(img, x, y, scaledWidth, scaledHeight);
        } catch (e) {
          console.error('Failed to load background image:', e);
          // Fallback to gradient
          const gradient = ctx.createLinearGradient(0, 0, width, height);
          gradient.addColorStop(0, '#667eea');
          gradient.addColorStop(1, '#764ba2');
          ctx.fillStyle = gradient;
          ctx.fillRect(0, 0, width, height);
        }
      }
    } else {
      // Default gradient
      const gradient = ctx.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, '#667eea');
      gradient.addColorStop(1, '#764ba2');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
    }

    // Sort elements by layer (lowest layer first, so they're drawn in the correct order)
    const allElements = this.allElements.slice().reverse();

    // Draw all elements
    for (const element of allElements) {
      if (!element.visible) continue;

      ctx.save();

      // Apply opacity
      ctx.globalAlpha = element.opacity ?? 1;

      if ('content' in element) {
        // Draw text element with clipping to match preview exactly
        const textElement = element as TextElement;
        const x = textElement.x ?? 0;
        const y = textElement.y ?? 0;
        const w = textElement.width ?? 300;
        const h = textElement.height ?? 100;
        const rotation = ((textElement.rotation ?? 0) * Math.PI) / 180;

        ctx.translate(x, y);
        ctx.rotate(rotation);

        // CRITICAL: Create clipping region to match element's width/height
        // This ensures text that overflows is cropped exactly like in the preview
        ctx.beginPath();
        ctx.rect(0, 0, w, h);
        ctx.clip();

        ctx.font = `${textElement.fontWeight || '700'} ${
          textElement.fontSize || 48
        }px ${textElement.fontFamily || 'Impact, sans-serif'}`;
        ctx.fillStyle = textElement.color || '#FFFFFF';
        ctx.textBaseline = 'top';

        // Multi-line support: Handle both explicit line breaks AND text wrapping
        const content = textElement.content || '';
        const fontSize = textElement.fontSize || 48;
        const lineHeight = fontSize * 1.2; // Match CSS line-height: 1.2

        // Split by explicit line breaks first
        const paragraphs = content.split('\n');
        const wrappedLines: string[] = [];

        // For each paragraph, wrap text based on element width
        paragraphs.forEach((paragraph) => {
          if (!paragraph) {
            wrappedLines.push(''); // Preserve empty lines
            return;
          }

          const words = paragraph.split(' ');
          let currentLine = '';

          words.forEach((word, index) => {
            const testLine = currentLine ? `${currentLine} ${word}` : word;
            const metrics = ctx.measureText(testLine);

            if (metrics.width > w && currentLine) {
              // Line is too long, push current line and start new one
              wrappedLines.push(currentLine);
              currentLine = word;
            } else {
              currentLine = testLine;
            }

            // Push the last line of the paragraph
            if (index === words.length - 1) {
              wrappedLines.push(currentLine);
            }
          });
        });

        // Draw each wrapped line with clipping
        wrappedLines.forEach((line, index) => {
          const yPos = index * lineHeight;

          // Draw stroke if present
          if (textElement.strokeWidth && textElement.strokeWidth > 0) {
            ctx.strokeStyle = textElement.strokeColor || '#000000';
            ctx.lineWidth = textElement.strokeWidth;
            ctx.lineJoin = 'round';
            ctx.strokeText(line, 0, yPos);
          }

          ctx.fillText(line, 0, yPos);
        });
      } else {
        // Draw visual element
        const visualElement = element as VisualElement;
        const x = visualElement.x ?? 0;
        const y = visualElement.y ?? 0;
        const w = visualElement.width ?? 100;
        const h = visualElement.height ?? 100;
        const rotation = ((visualElement.rotation ?? 0) * Math.PI) / 180;

        ctx.translate(x + w / 2, y + h / 2);
        ctx.rotate(rotation);
        ctx.translate(-w / 2, -h / 2);

        ctx.fillStyle = visualElement.fillColor || '#000';
        ctx.strokeStyle = visualElement.strokeColor || '#000';
        ctx.lineWidth = visualElement.strokeWidth ?? 2;

        if (visualElement.type === 'circle') {
          ctx.beginPath();
          ctx.arc(w / 2, h / 2, Math.min(w, h) / 2, 0, Math.PI * 2);
          ctx.fill();
          if (ctx.lineWidth > 0) ctx.stroke();
        } else if (visualElement.type === 'arrow') {
          ctx.beginPath();
          ctx.moveTo(0, h * 0.2);
          ctx.lineTo(w * 0.6, h * 0.2);
          ctx.lineTo(w * 0.6, 0);
          ctx.lineTo(w, h * 0.5);
          ctx.lineTo(w * 0.6, h);
          ctx.lineTo(w * 0.6, h * 0.8);
          ctx.lineTo(0, h * 0.8);
          ctx.closePath();
          ctx.fill();
          if (ctx.lineWidth > 0) ctx.stroke();
        } else {
          // Rectangle
          ctx.fillRect(0, 0, w, h);
          if (ctx.lineWidth > 0) ctx.strokeRect(0, 0, w, h);
        }
      }

      ctx.restore();
    }

    // Convert canvas to blob and download
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${this.args.model?.title || 'youtube-thumbnail'}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }, 'image/png');
  }

  @action
  addTextElement() {
    const newElement = new TextElement();
    newElement.content = 'AMAZING!';
    newElement.x = Math.random() * 300 + 50;
    newElement.y = Math.random() * 150 + 100;
    newElement.width = 300;
    newElement.height = 100;
    newElement.fontSize = 48;
    newElement.fontFamily = 'Impact, sans-serif';
    newElement.fontWeight = '700';
    newElement.color = '#FFFFFF';
    newElement.strokeColor = '#000000';
    newElement.strokeWidth = 2;
    newElement.visible = true; // Explicitly set visible
    newElement.rotation = 0; // Set rotation

    // Find the highest layer index among all elements and add 1
    const allElements = this.allElements;
    const maxLayer =
      allElements.length > 0
        ? Math.max(...allElements.map((el) => el.layer ?? 0))
        : 0;
    newElement.layer = maxLayer + 1;

    newElement.opacity = 1;

    if (!this.args.model.textElements) {
      this.args.model.textElements = [];
    }
    this.args.model.textElements = [
      ...this.args.model.textElements,
      newElement,
    ];
    this.selectedElement = newElement;
  }

  @action
  addVisualElement(type: string) {
    const newElement = new VisualElement();
    newElement.type = type;
    newElement.x = Math.random() * 300 + 200;
    newElement.y = Math.random() * 200 + 150;
    newElement.visible = true; // Explicitly set visible
    newElement.rotation = 0; // Set rotation

    // Find the highest layer index among all elements and add 1
    const allElements = this.allElements;
    const maxLayer =
      allElements.length > 0
        ? Math.max(...allElements.map((el) => el.layer ?? 0))
        : 0;
    newElement.layer = maxLayer + 1;

    if (type === 'arrow') {
      newElement.width = 120;
      newElement.height = 30;
      newElement.fillColor = '#FFFF00';
      newElement.strokeColor = '#FF0000';
      newElement.strokeWidth = 3;
    } else if (type === 'circle') {
      newElement.width = 100;
      newElement.height = 100;
      newElement.fillColor = '#FF4444';
      newElement.strokeColor = '#FFFFFF';
      newElement.strokeWidth = 4;
    } else {
      newElement.width = 150;
      newElement.height = 80;
      newElement.fillColor = '#00FFFF';
      newElement.strokeColor = '#000000';
      newElement.strokeWidth = 2;
    }

    if (!this.args.model.visualElements) {
      this.args.model.visualElements = [];
    }
    this.args.model.visualElements = [
      ...this.args.model.visualElements,
      newElement,
    ];
    this.selectedElement = newElement;
  }

  @action
  updateElementProperty(
    element: TextElement | VisualElement,
    property: string,
    event: Event,
  ) {
    if (element && property) {
      (element as any)[property] = (event.target as HTMLInputElement).value;
    }
  }

  @action
  updateElementNumericProperty(
    element: TextElement | VisualElement,
    property: string,
    value: string,
  ) {
    if (element && property) {
      // Parse the value appropriately
      const numValue =
        property === 'opacity' ? parseFloat(value) : parseInt(value, 10);
      (element as any)[property] = numValue;
    }
  }

  @action
  updateBackgroundProperty(property: string, event: Event) {
    if (this.args.model?.background) {
      (this.args.model.background as any)[property] = (
        event.target as HTMLInputElement
      ).value;
    }
  }

  @action
  toggleElementVisibility(element: TextElement | VisualElement) {
    element.visible = !element.visible;
  }

  @action
  deleteElement(element: TextElement | VisualElement) {
    if (this.args.model.textElements?.includes(element as TextElement)) {
      this.args.model.textElements = this.args.model.textElements.filter(
        (el) => el !== element,
      );
    }
    if (this.args.model.visualElements?.includes(element as VisualElement)) {
      this.args.model.visualElements = this.args.model.visualElements.filter(
        (el) => el !== element,
      );
    }
    if (this.selectedElement === element) {
      this.selectedElement = null;
    }
  }

  @action
  duplicateElement(element: TextElement | VisualElement) {
    let newElement: TextElement | VisualElement | undefined;

    if (this.args.model.textElements?.includes(element as TextElement)) {
      const textElement = element as TextElement;
      newElement = new TextElement();
      // Copy all properties explicitly
      newElement.content = textElement.content;
      newElement.x = textElement.x + 20;
      newElement.y = textElement.y + 20;
      newElement.width = textElement.width;
      newElement.height = textElement.height;
      newElement.fontSize = textElement.fontSize;
      newElement.fontFamily = textElement.fontFamily;
      newElement.fontWeight = textElement.fontWeight;
      newElement.color = textElement.color;
      newElement.strokeColor = textElement.strokeColor;
      newElement.strokeWidth = textElement.strokeWidth;
      newElement.rotation = textElement.rotation;
      newElement.visible = textElement.visible;
      newElement.layer = textElement.layer;

      this.args.model.textElements = [
        ...this.args.model.textElements,
        newElement,
      ];
    } else if (
      this.args.model.visualElements?.includes(element as VisualElement)
    ) {
      const visualElement = element as VisualElement;
      newElement = new VisualElement();
      // Copy all properties explicitly
      newElement.type = visualElement.type;
      newElement.x = visualElement.x + 20;
      newElement.y = visualElement.y + 20;
      newElement.width = visualElement.width;
      newElement.height = visualElement.height;
      newElement.rotation = visualElement.rotation;
      newElement.fillColor = visualElement.fillColor;
      newElement.strokeColor = visualElement.strokeColor;
      newElement.strokeWidth = visualElement.strokeWidth;
      newElement.visible = visualElement.visible;
      newElement.layer = visualElement.layer;
      newElement.iconName = visualElement.iconName;

      this.args.model.visualElements = [
        ...this.args.model.visualElements,
        newElement,
      ];
    }

    if (newElement) {
      this.selectedElement = newElement;
    }
  }

  @action
  handleDrag(element: TextElement | VisualElement, x: number, y: number) {
    element.x = x;
    element.y = y;
  }

  @action
  handleResize(
    element: TextElement | VisualElement,
    width: number,
    height: number,
  ) {
    element.width = width;
    element.height = height;
  }

  @action
  handleDoubleClick(element: TextElement | VisualElement, event: MouseEvent) {
    if ('content' in element && element.content !== undefined) {
      event.stopPropagation();
      this.editingElement = element as TextElement;
      this.tempEditContent = element.content || '';
      // Focus the input after a brief delay to ensure it's rendered
      setTimeout(() => {
        const el = document.querySelector(
          '.inline-text-editor',
        ) as HTMLElement | null;
        if (!el) return;

        // Set the content directly to the contenteditable div
        el.textContent = this.tempEditContent;

        el.focus();
        // place caret at end
        if (window.getSelection) {
          const range = document.createRange();
          range.selectNodeContents(el);
          range.collapse(false);
          const sel = window.getSelection();
          sel?.removeAllRanges();
          sel?.addRange(range);
        }
      }, 10);
    }
  }

  @action
  saveEditing(event?: MouseEvent) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    }

    // Get the latest content from the contenteditable div
    const el = document.querySelector(
      '.inline-text-editor',
    ) as HTMLElement | null;
    if (el) {
      this.tempEditContent = el.innerText || el.textContent || '';
    }

    if (this.editingElement && this.tempEditContent !== undefined) {
      this.editingElement.content = this.tempEditContent;
    }
    this.editingElement = null;
    this.tempEditContent = '';
  }

  @action
  cancelEditing() {
    this.editingElement = null;
    this.tempEditContent = '';
  }

  @action
  updateInlineText(event: Event) {
    const target = event.target as HTMLElement;
    // Update temp value when content changes
    this.tempEditContent = target.innerText || target.textContent || '';
  }

  @action
  handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.cancelEditing();
    }
    // Allow Enter key for new lines - don't prevent default
  }

  @action
  reorderLayers(reorderedElements: (TextElement | VisualElement)[]) {
    // Update z-index (layer) for each element based on its position in the list
    // Elements at the start of the list have higher z-index (top), elements at the end have lower z-index (bottom)
    const totalElements = reorderedElements.length;
    reorderedElements.forEach((element, index) => {
      element.layer = totalElements - index;
    });

    // Update the model arrays to match the new order
    const textElements = reorderedElements.filter(
      (el) => 'content' in el,
    ) as TextElement[];
    const visualElements = reorderedElements.filter(
      (el) => !('content' in el),
    ) as VisualElement[];

    if (textElements.length > 0) {
      this.args.model.textElements = textElements;
    }
    if (visualElements.length > 0) {
      this.args.model.visualElements = visualElements;
    }
  }

  getElementLabel(element: TextElement | VisualElement): string {
    if ('content' in element) {
      return `Text: ${element.content || 'Empty'}`;
    } else {
      return (element as VisualElement).type || 'Shape';
    }
  }

  <template>
    <div class='composer-app'>
      <div class='app-header'>
        <h1><ImageIcon /> YouTube Thumbnail Composer</h1>
        <div class='header-controls'>
          <Button
            @kind={{if @model.showGrid 'primary' 'secondary-light'}}
            @size='small'
            {{on 'click' this.toggleGrid}}
          >
            {{if @model.showGrid 'Grid On' 'Grid Off'}}
          </Button>
          <Button
            @kind='primary-dark'
            @size='small'
            {{on 'click' this.exportThumbnail}}
          >
            Export Thumbnail
          </Button>
        </div>
      </div>

      <div class='composer-layout'>
        <div class='preview-panel'>
          <div class='preview-container'>
            {{! eslint-disable-next-line no-invalid-interactive }}
            <div
              class='thumbnail-preview {{if @model.showGrid "show-grid"}}'
              tabindex='0'
              style={{htmlSafe
                (concat
                  'width: '
                  this.previewWidth
                  'px; height: '
                  this.previewHeight
                  'px; '
                  this.backgroundStyle
                )
              }}
              {{on 'click' (fn this.selectElement null)}}
              {{on 'dblclick' this.handleBackgroundDoubleClick}}
            >

              {{#if @model.showGrid}}
                <div
                  class='grid-overlay'
                  style={{htmlSafe
                    (concat
                      'background-size: '
                      (multiply 20 this.scaleRatio)
                      'px '
                      (multiply 20 this.scaleRatio)
                      'px; background-position: 0 0;'
                    )
                  }}
                ></div>
              {{/if}}

              {{#each @model.visualElements as |element|}}
                {{#if element.visible}}
                  <button
                    type='button'
                    class='visual-element
                      {{element.type}}
                      {{if (eq this.selectedElement element) "selected"}}'
                    style={{htmlSafe
                      (concat
                        'left: '
                        (multiply element.x this.scaleRatio)
                        'px; top: '
                        (multiply element.y this.scaleRatio)
                        'px; width: '
                        (multiply element.width this.scaleRatio)
                        'px; height: '
                        (multiply element.height this.scaleRatio)
                        'px; background: '
                        element.fillColor
                        '; border: '
                        (multiply element.strokeWidth this.scaleRatio)
                        'px solid '
                        element.strokeColor
                        '; transform: rotate('
                        element.rotation
                        'deg); z-index: '
                        element.layer
                        '; opacity: '
                        element.opacity
                        ';'
                      )
                    }}
                    {{on 'click' (fn this.selectElement element)}}
                    {{DragModifier
                      (fn this.handleDrag element)
                      this.scaleRatio
                      (fn this.handleResize element)
                    }}
                  >
                    {{#if (eq this.selectedElement element)}}
                      <div
                        class='resize-handle'
                        aria-label='Resize element'
                      ></div>
                    {{/if}}
                  </button>
                {{/if}}
              {{/each}}

              {{#each @model.textElements as |element|}}
                {{#if element.visible}}
                  {{#if (eq this.editingElement element)}}
                    <div
                      class='inline-editor-container'
                      style={{htmlSafe
                        (concat
                          'left: '
                          (multiply element.x this.scaleRatio)
                          'px; top: '
                          (multiply element.y this.scaleRatio)
                          'px; width: '
                          (multiply (this.getTextWidth element) this.scaleRatio)
                          'px; height: '
                          (multiply
                            (this.getTextHeight element) this.scaleRatio
                          )
                          'px; transform: rotate('
                          element.rotation
                          'deg); z-index: '
                          element.layer
                          '; opacity: '
                          element.opacity
                          ';'
                        )
                      }}
                    >
                      <div
                        class='inline-text-editor'
                        contenteditable='true'
                        spellcheck='false'
                        role='textbox'
                        tabindex='0'
                        style={{htmlSafe
                          (concat
                            'font-size: '
                            (multiply element.fontSize this.scaleRatio)
                            'px; font-family: '
                            element.fontFamily
                            '; font-weight: '
                            element.fontWeight
                            '; color: '
                            element.color
                            '; -webkit-text-stroke: '
                            (multiply element.strokeWidth this.scaleRatio)
                            'px '
                            element.strokeColor
                            ';'
                          )
                        }}
                        {{on 'input' this.updateInlineText}}
                        {{on 'keydown' this.handleKeyDown}}
                      ></div>
                      <button
                        type='button'
                        class='save-edit-button'
                        {{on 'mouseup' this.saveEditing}}
                        aria-label='Save text changes'
                      >
                        <CheckIcon width='12' height='12' />
                      </button>
                    </div>
                  {{else}}
                    <button
                      type='button'
                      class='text-element
                        {{if (eq this.selectedElement element) "selected"}}'
                      style={{htmlSafe
                        (concat
                          'left: '
                          (multiply element.x this.scaleRatio)
                          'px; top: '
                          (multiply element.y this.scaleRatio)
                          'px; width: '
                          (multiply (this.getTextWidth element) this.scaleRatio)
                          'px; height: '
                          (multiply
                            (this.getTextHeight element) this.scaleRatio
                          )
                          'px; font-size: '
                          (multiply element.fontSize this.scaleRatio)
                          'px; font-family: '
                          element.fontFamily
                          '; font-weight: '
                          element.fontWeight
                          '; color: '
                          element.color
                          '; -webkit-text-stroke: '
                          (multiply element.strokeWidth this.scaleRatio)
                          'px '
                          element.strokeColor
                          '; transform: rotate('
                          element.rotation
                          'deg); z-index: '
                          element.layer
                          '; opacity: '
                          element.opacity
                          ';'
                        )
                      }}
                      {{on 'click' (fn this.selectElement element)}}
                      {{on 'dblclick' (fn this.handleDoubleClick element)}}
                      {{DragModifier
                        (fn this.handleDrag element)
                        this.scaleRatio
                        (fn this.handleResize element)
                      }}
                    >
                      {{element.content}}
                      {{#if (eq this.selectedElement element)}}
                        <div
                          class='resize-handle'
                          aria-label='Resize element'
                        ></div>
                      {{/if}}
                    </button>
                  {{/if}}
                {{/if}}
              {{/each}}
            </div>
          </div>
        </div>

        <div class='tools-panel'>
          <div class='panel-tabs'>
            <button
              class='tab {{if (eq this.activeTab "elements") "active"}}'
              {{on 'click' (fn (mut this.activeTab) 'elements')}}
            >
              <LayersIcon />
              Elements
            </button>
            <button
              class='tab {{if (eq this.activeTab "properties") "active"}}'
              {{on 'click' (fn (mut this.activeTab) 'properties')}}
            >
              <TypeIcon />
              Properties
            </button>
            <button
              class='tab {{if (eq this.activeTab "background") "active"}}'
              {{on 'click' (fn (mut this.activeTab) 'background')}}
            >
              Background
            </button>
          </div>

          {{#if (eq this.activeTab 'elements')}}
            <div class='elements-tab'>

              <Button @kind='primary' {{on 'click' this.addTextElement}}>
                <TypeIcon />
                Add Text
              </Button>

              <hr />

              <h3>Add Shape</h3>
              <div class='button-group'>
                <Button
                  @kind='secondary'
                  {{on 'click' (fn this.addVisualElement 'arrow')}}
                >➤ Arrow</Button>
                <Button
                  @kind='secondary'
                  {{on 'click' (fn this.addVisualElement 'circle')}}
                >● Circle</Button>
                <Button
                  @kind='secondary'
                  {{on 'click' (fn this.addVisualElement 'rectangle')}}
                >■ Rectangle</Button>
              </div>
            </div>
          {{/if}}

          {{#if (eq this.activeTab 'properties')}}
            <div class='properties-tab'>
              {{#if this.selectedElement}}
                <h3>Edit Element</h3>
                <div class='property-actions'>
                  <Button
                    @kind='secondary-light'
                    @size='small'
                    {{on
                      'click'
                      (fn this.duplicateElement this.selectedElement)
                    }}
                  >
                    <CopyIcon />
                    Duplicate
                  </Button>
                  <Button
                    @kind='danger-light'
                    @size='small'
                    {{on 'click' (fn this.deleteElement this.selectedElement)}}
                  >
                    <TrashIcon />
                    Delete
                  </Button>
                </div>

                {{! Edit all element properties with BoxelInput controls }}
                {{#if this.isTextElement}}
                  {{#if this.selectedTextElement}}
                    <div class='element-edit-form'>
                      <FieldContainer @label='Content'>
                        <input
                          type='text'
                          aria-label='Text content'
                          value={{this.selectedTextElement.content}}
                          {{on
                            'input'
                            (fn
                              this.updateElementProperty
                              this.selectedElement
                              'content'
                            )
                          }}
                        />
                      </FieldContainer>

                      <FieldContainer @label='Font Size'>
                        <div class='range-control'>
                          <BoxelInput
                            @type='range'
                            @value={{this.textFontSize}}
                            @onInput={{fn
                              this.updateElementNumericProperty
                              this.selectedElement
                              'fontSize'
                            }}
                            min='12'
                            max='200'
                            step='1'
                          />
                          <span
                            class='range-value'
                          >{{this.textFontSize}}px</span>
                        </div>
                      </FieldContainer>

                      <FieldContainer @label='Font Family'>
                        <select
                          aria-label='Font family'
                          {{on
                            'change'
                            (fn
                              this.updateElementProperty
                              this.selectedElement
                              'fontFamily'
                            )
                          }}
                        >
                          <option
                            value='Arial, sans-serif'
                            selected={{eq
                              this.selectedTextElement.fontFamily
                              'Arial, sans-serif'
                            }}
                          >Arial</option>
                          <option
                            value='Impact, sans-serif'
                            selected={{eq
                              this.selectedTextElement.fontFamily
                              'Impact, sans-serif'
                            }}
                          >Impact</option>
                          <option
                            value='"Comic Sans MS", cursive'
                            selected={{eq
                              this.selectedTextElement.fontFamily
                              '"Comic Sans MS", cursive'
                            }}
                          >Comic Sans</option>
                          <option
                            value='"Times New Roman", serif'
                            selected={{eq
                              this.selectedTextElement.fontFamily
                              '"Times New Roman", serif'
                            }}
                          >Times New Roman</option>
                          <option
                            value='"Courier New", monospace'
                            selected={{eq
                              this.selectedTextElement.fontFamily
                              '"Courier New", monospace'
                            }}
                          >Courier</option>
                          <option
                            value='Georgia, serif'
                            selected={{eq
                              this.selectedTextElement.fontFamily
                              'Georgia, serif'
                            }}
                          >Georgia</option>
                          <option
                            value='Verdana, sans-serif'
                            selected={{eq
                              this.selectedTextElement.fontFamily
                              'Verdana, sans-serif'
                            }}
                          >Verdana</option>
                          <option
                            value='Helvetica, sans-serif'
                            selected={{eq
                              this.selectedTextElement.fontFamily
                              'Helvetica, sans-serif'
                            }}
                          >Helvetica</option>
                        </select>
                      </FieldContainer>

                      <FieldContainer @label='Font Weight'>
                        <select
                          aria-label='Font weight'
                          {{on
                            'change'
                            (fn
                              this.updateElementProperty
                              this.selectedElement
                              'fontWeight'
                            )
                          }}
                        >
                          <option
                            value='400'
                            selected={{eq
                              this.selectedTextElement.fontWeight
                              '400'
                            }}
                          >Normal</option>
                          <option
                            value='700'
                            selected={{eq
                              this.selectedTextElement.fontWeight
                              '700'
                            }}
                          >Bold</option>
                          <option
                            value='900'
                            selected={{eq
                              this.selectedTextElement.fontWeight
                              '900'
                            }}
                          >Extra Bold</option>
                        </select>
                      </FieldContainer>

                      <div class='field-row'>
                        <FieldContainer @label='Text Color'>
                          <input
                            type='color'
                            aria-label='Text color'
                            value={{this.selectedTextElement.color}}
                            {{on
                              'input'
                              (fn
                                this.updateElementProperty
                                this.selectedElement
                                'color'
                              )
                            }}
                          />
                        </FieldContainer>
                        <FieldContainer @label='Stroke Color'>
                          <input
                            type='color'
                            aria-label='Stroke color'
                            value={{this.selectedTextElement.strokeColor}}
                            {{on
                              'input'
                              (fn
                                this.updateElementProperty
                                this.selectedElement
                                'strokeColor'
                              )
                            }}
                          />
                        </FieldContainer>
                      </div>

                      <FieldContainer @label='Stroke Width'>
                        <div class='range-control'>
                          <BoxelInput
                            @type='range'
                            @value={{this.textStrokeWidth}}
                            @onInput={{fn
                              this.updateElementNumericProperty
                              this.selectedElement
                              'strokeWidth'
                            }}
                            min='0'
                            max='20'
                            step='0.5'
                          />
                          <span
                            class='range-value'
                          >{{this.textStrokeWidth}}px</span>
                        </div>
                      </FieldContainer>

                      <div class='field-row'>
                        <FieldContainer @label='X Position'>
                          <input
                            type='number'
                            aria-label='X position'
                            value={{this.selectedTextElement.x}}
                            {{on
                              'input'
                              (fn
                                this.updateElementProperty
                                this.selectedElement
                                'x'
                              )
                            }}
                          />
                        </FieldContainer>
                        <FieldContainer @label='Y Position'>
                          <input
                            type='number'
                            aria-label='Y position'
                            value={{this.selectedTextElement.y}}
                            {{on
                              'input'
                              (fn
                                this.updateElementProperty
                                this.selectedElement
                                'y'
                              )
                            }}
                          />
                        </FieldContainer>
                      </div>

                      <div class='field-row'>
                        <FieldContainer @label='Width'>
                          <input
                            type='number'
                            aria-label='Element width'
                            value={{this.selectedTextElement.width}}
                            {{on
                              'input'
                              (fn
                                this.updateElementProperty
                                this.selectedElement
                                'width'
                              )
                            }}
                          />
                        </FieldContainer>
                        <FieldContainer @label='Height'>
                          <input
                            type='number'
                            aria-label='Element height'
                            value={{this.selectedTextElement.height}}
                            {{on
                              'input'
                              (fn
                                this.updateElementProperty
                                this.selectedElement
                                'height'
                              )
                            }}
                          />
                        </FieldContainer>
                      </div>

                      <FieldContainer @label='Rotation'>
                        <div class='range-control'>
                          <BoxelInput
                            @type='range'
                            @value={{this.textRotation}}
                            @onInput={{fn
                              this.updateElementNumericProperty
                              this.selectedElement
                              'rotation'
                            }}
                            min='-180'
                            max='180'
                            step='1'
                          />
                          <span
                            class='range-value'
                          >{{this.textRotation}}°</span>
                        </div>
                      </FieldContainer>

                      <div class='field-row'>
                        <FieldContainer @label='Layer (Z-Index)'>
                          <input
                            type='number'
                            aria-label='Layer z-index'
                            value={{this.textLayer}}
                            {{on
                              'input'
                              (fn
                                this.updateElementProperty
                                this.selectedElement
                                'layer'
                              )
                            }}
                          />
                        </FieldContainer>
                        <FieldContainer @label='Opacity'>
                          <div class='range-control'>
                            <BoxelInput
                              @type='range'
                              @value={{this.textOpacity}}
                              @onInput={{fn
                                this.updateElementNumericProperty
                                this.selectedElement
                                'opacity'
                              }}
                              min='0'
                              max='1'
                              step='0.1'
                            />
                            <span
                              class='range-value'
                            >{{this.textOpacity}}</span>
                          </div>
                        </FieldContainer>
                      </div>

                      <FieldContainer @label='Visible'>
                        <input
                          type='checkbox'
                          aria-label='Element visibility'
                          checked={{this.selectedTextElement.visible}}
                          {{on
                            'change'
                            (fn
                              this.toggleElementVisibility this.selectedElement
                            )
                          }}
                        />
                      </FieldContainer>
                    </div>
                  {{/if}}
                {{else}}
                  {{#if this.selectedVisualElement}}
                    <div class='element-edit-form'>
                      <FieldContainer @label='Element Type'>
                        <select
                          aria-label='Element type'
                          {{on
                            'change'
                            (fn
                              this.updateElementProperty
                              this.selectedElement
                              'type'
                            )
                          }}
                        >
                          <option
                            value='rectangle'
                            selected={{eq
                              this.selectedVisualElement.type
                              'rectangle'
                            }}
                          >Rectangle</option>
                          <option
                            value='circle'
                            selected={{eq
                              this.selectedVisualElement.type
                              'circle'
                            }}
                          >Circle</option>
                          <option
                            value='arrow'
                            selected={{eq
                              this.selectedVisualElement.type
                              'arrow'
                            }}
                          >Arrow</option>
                        </select>
                      </FieldContainer>

                      <div class='field-row'>
                        <FieldContainer @label='Width'>
                          <input
                            type='number'
                            aria-label='Element width'
                            value={{this.selectedVisualElement.width}}
                            {{on
                              'input'
                              (fn
                                this.updateElementProperty
                                this.selectedElement
                                'width'
                              )
                            }}
                          />
                        </FieldContainer>
                        <FieldContainer @label='Height'>
                          <input
                            type='number'
                            aria-label='Element height'
                            value={{this.selectedVisualElement.height}}
                            {{on
                              'input'
                              (fn
                                this.updateElementProperty
                                this.selectedElement
                                'height'
                              )
                            }}
                          />
                        </FieldContainer>
                      </div>

                      <div class='field-row'>
                        <FieldContainer @label='Fill Color'>
                          <input
                            type='color'
                            aria-label='Fill color'
                            value={{this.selectedVisualElement.fillColor}}
                            {{on
                              'input'
                              (fn
                                this.updateElementProperty
                                this.selectedElement
                                'fillColor'
                              )
                            }}
                          />
                        </FieldContainer>
                        <FieldContainer @label='Stroke Color'>
                          <input
                            type='color'
                            aria-label='Stroke color'
                            value={{this.selectedVisualElement.strokeColor}}
                            {{on
                              'input'
                              (fn
                                this.updateElementProperty
                                this.selectedElement
                                'strokeColor'
                              )
                            }}
                          />
                        </FieldContainer>
                      </div>

                      <FieldContainer @label='Stroke Width'>
                        <div class='range-control'>
                          <BoxelInput
                            @type='range'
                            @value={{this.visualStrokeWidth}}
                            @onInput={{fn
                              this.updateElementNumericProperty
                              this.selectedElement
                              'strokeWidth'
                            }}
                            min='0'
                            max='20'
                            step='0.5'
                          />
                          <span
                            class='range-value'
                          >{{this.visualStrokeWidth}}px</span>
                        </div>
                      </FieldContainer>

                      <div class='field-row'>
                        <FieldContainer @label='X Position'>
                          <input
                            type='number'
                            aria-label='X position'
                            value={{this.selectedVisualElement.x}}
                            {{on
                              'input'
                              (fn
                                this.updateElementProperty
                                this.selectedElement
                                'x'
                              )
                            }}
                          />
                        </FieldContainer>
                        <FieldContainer @label='Y Position'>
                          <input
                            type='number'
                            aria-label='Y position'
                            value={{this.selectedVisualElement.y}}
                            {{on
                              'input'
                              (fn
                                this.updateElementProperty
                                this.selectedElement
                                'y'
                              )
                            }}
                          />
                        </FieldContainer>
                      </div>

                      <FieldContainer @label='Rotation'>
                        <div class='range-control'>
                          <BoxelInput
                            @type='range'
                            @value={{this.visualRotation}}
                            @onInput={{fn
                              this.updateElementNumericProperty
                              this.selectedElement
                              'rotation'
                            }}
                            min='-180'
                            max='180'
                            step='1'
                          />
                          <span
                            class='range-value'
                          >{{this.visualRotation}}°</span>
                        </div>
                      </FieldContainer>

                      <div class='field-row'>
                        <FieldContainer @label='Layer (Z-Index)'>
                          <input
                            type='number'
                            aria-label='Layer z-index'
                            value={{this.visualLayer}}
                            {{on
                              'input'
                              (fn
                                this.updateElementProperty
                                this.selectedElement
                                'layer'
                              )
                            }}
                          />
                        </FieldContainer>
                        <FieldContainer @label='Opacity'>
                          <div class='range-control'>
                            <BoxelInput
                              @type='range'
                              @value={{this.visualOpacity}}
                              @onInput={{fn
                                this.updateElementNumericProperty
                                this.selectedElement
                                'opacity'
                              }}
                              min='0'
                              max='1'
                              step='0.1'
                            />
                            <span
                              class='range-value'
                            >{{this.visualOpacity}}</span>
                          </div>
                        </FieldContainer>
                      </div>

                      <FieldContainer @label='Visible'>
                        <input
                          type='checkbox'
                          aria-label='Element visibility'
                          checked={{this.selectedVisualElement.visible}}
                          {{on
                            'change'
                            (fn
                              this.toggleElementVisibility this.selectedElement
                            )
                          }}
                        />
                      </FieldContainer>
                    </div>
                  {{/if}}
                {{/if}}
              {{else}}
                <p class='no-selection'>Click an element to edit its properties</p>
              {{/if}}
            </div>
          {{/if}}

          {{#if (eq this.activeTab 'background')}}
            <div class='background-tab'>
              <@fields.background @format='edit' />
            </div>
          {{/if}}

          <div class='layers-panel'>
            <h3>Layers (Drag to Reorder)</h3>
            <ul
              class='layers-list'
              {{sortableGroup
                groupName=this.sortableGroupId
                onChange=this.reorderLayers
              }}
            >
              {{#each this.allElements as |element|}}
                <li
                  class='layer-item
                    {{if (eq this.selectedElement element) "selected"}}'
                  {{sortableItem groupName=this.sortableGroupId model=element}}
                >
                  <button
                    type='button'
                    class='drag-handle'
                    {{sortableHandle}}
                    aria-label='Drag to reorder'
                  >
                    <FourLines width='16' height='16' />
                  </button>
                  <button
                    type='button'
                    class='visibility-toggle'
                    {{on 'click' (fn this.toggleElementVisibility element)}}
                    aria-label={{if element.visible 'Hide' 'Show'}}
                  >
                    {{#if element.visible}}<EyeIcon
                        width='16'
                        height='16'
                      />{{else}}<EyeOffIcon width='16' height='16' />{{/if}}
                  </button>
                  <button
                    type='button'
                    class='layer-name'
                    {{on 'click' (fn this.selectElement element)}}
                  >
                    {{this.getElementLabel element}}
                  </button>
                  <span class='layer-z-index'>z:{{element.layer}}</span>
                  <button
                    type='button'
                    class='delete-button'
                    {{on 'click' (fn this.deleteElement element)}}
                    aria-label='Delete'
                  >
                    <TrashIcon width='16' height='16' />
                  </button>
                </li>
              {{/each}}
            </ul>
          </div>
        </div>
      </div>
    </div>

    <style scoped>
      .composer-app {
        width: 100%;
        height: 100vh;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        font-family:
          -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }

      .app-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 20px;
        background: rgba(255, 255, 255, 0.95);
        border-bottom: 2px solid #e5e7eb;
      }

      .app-header h1 {
        display: flex;
        align-items: center;
        gap: 12px;
        margin: 0;
        font-size: 24px;
        font-weight: 700;
      }

      .header-controls {
        display: flex;
        gap: 12px;
        align-items: center;
      }

      .composer-layout {
        flex: 1;
        display: flex;
        overflow: hidden;
      }

      .preview-panel {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 40px;
      }

      .thumbnail-preview {
        position: relative;
        border: 4px solid white;
        border-radius: 12px;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
        overflow: hidden;
        box-sizing: border-box;
        padding: 0;
        cursor: default;
        text-align: left;
      }

      .thumbnail-preview.show-grid .grid-overlay {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        width: 100%;
        height: 100%;
        background-image:
          linear-gradient(rgba(255, 255, 255, 0.2) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255, 255, 255, 0.2) 1px, transparent 1px);
        background-size: 20px 20px;
        pointer-events: none;
        z-index: 1000;
      }

      .text-element,
      .visual-element {
        position: absolute;
        cursor: grab;
        user-select: none;
        box-sizing: border-box;
        padding: 0;
        background: none;
        border: none;
        text-align: left;
      }

      .text-element {
        white-space: pre-wrap;
        word-wrap: break-word;
        overflow-wrap: break-word;
        overflow: hidden;
        display: flex;
        line-height: 1.2;
        align-items: flex-start;
        justify-content: flex-start;
      }

      .visual-element {
        white-space: nowrap;
      }

      .text-element:active,
      .visual-element:active {
        cursor: grabbing;
      }

      .resize-handle {
        position: absolute;
        bottom: -6px;
        right: -6px;
        width: 12px;
        height: 12px;
        background: #6600ff;
        border: 2px solid white;
        border-radius: 50%;
        cursor: nwse-resize;
        z-index: 10;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
        pointer-events: auto;
      }

      .resize-handle:hover {
        background: #5500dd;
        transform: scale(1.2);
      }

      .resize-handle:active {
        cursor: nwse-resize;
      }

      .inline-editor-container {
        position: absolute;
        transform-origin: 0 0;
        box-sizing: border-box;
      }

      .inline-text-editor {
        position: relative;
        background: transparent;
        border: 2px dashed #6600ff;
        margin: 0;
        outline: none;
        width: 100%;
        height: 100%;
        transform-origin: 0 0;
        box-sizing: border-box;
        line-height: 1.2;
        min-width: 20px;
        z-index: 1;
        caret-color: currentColor;
        white-space: pre-wrap;
        word-wrap: break-word;
        overflow-wrap: break-word;
        overflow-y: auto;
      }

      .save-edit-button {
        position: absolute;
        top: 4px;
        right: 4px;
        background: #6600ff;
        color: white;
        border: none;
        border-radius: 4px;
        width: 28px;
        height: 28px;
        padding: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
        transition: all 0.2s;
        z-index: 1000;
        pointer-events: auto;
      }

      .save-edit-button:hover {
        background: #5500dd;
        transform: scale(1.1);
      }

      .save-edit-button:active {
        transform: scale(0.95);
      }

      .preview-container {
        position: relative;
      }

      .text-element.selected,
      .visual-element.selected {
        outline: 3px dashed #6600ff;
        outline-offset: 4px;
      }

      .visual-element.circle {
        border-radius: 50%;
      }

      .visual-element.arrow {
        clip-path: polygon(
          0% 20%,
          60% 20%,
          60% 0%,
          100% 50%,
          60% 100%,
          60% 80%,
          0% 80%
        );
      }

      .tools-panel {
        width: 350px;
        background: white;
        display: flex;
        flex-direction: column;
        overflow-y: auto;
      }

      .panel-tabs {
        display: flex;
        border-bottom: 1px solid #e5e7eb;
      }

      .tab {
        flex: 1;
        display: flex;
        align-items: center;
        gap: 8px;
        justify-content: center;
        padding: 12px;
        border: none;
        background: none;
        cursor: pointer;
        border-bottom: 2px solid transparent;
      }

      .tab.active {
        border-bottom-color: #6600ff;
      }

      .elements-tab,
      .properties-tab,
      .background-tab {
        padding: 20px;
      }

      .elements-tab h3,
      .properties-tab h3,
      .background-tab h3 {
        margin: 0 0 16px 0;
      }

      .button-group {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
        margin-top: 12px;
      }

      .property-actions {
        display: flex;
        gap: 8px;
        margin-bottom: 16px;
      }

      label {
        display: block;
        margin: 12px 0 4px;
        font-size: 14px;
        font-weight: 500;
      }

      input[type='text'],
      input[type='number'],
      select {
        width: 100%;
        padding: 8px;
        border: 1px solid #d1d5db;
        border-radius: 4px;
      }

      input[type='color'] {
        width: 100%;
        height: 40px;
        border: 1px solid #d1d5db;
        border-radius: 4px;
        cursor: pointer;
      }

      input[type='range'] {
        flex: 1;
        margin-right: 8px;
      }

      input[type='range'] + span {
        display: inline-block;
        min-width: 50px;
        text-align: right;
        font-size: 14px;
        color: #6b7280;
      }

      hr {
        margin: 20px 0;
        border: none;
        border-top: 1px solid #e5e7eb;
      }

      h4 {
        margin: 0 0 12px 0;
        font-size: 16px;
        font-weight: 600;
        color: #374151;
      }

      .no-selection {
        text-align: center;
        padding: 40px 20px;
        color: #9ca3af;
      }

      .layers-panel {
        border-top: 1px solid #e5e7eb;
        padding: 20px;
        margin-top: auto;
      }

      .layers-panel h3 {
        margin: 0 0 12px 0;
        font-size: 14px;
        font-weight: 600;
      }

      .layers-list {
        list-style: none;
        padding: 0;
        margin: 0;
      }

      .layer-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px;
        margin-bottom: 4px;
        border-radius: 4px;
        background: white;
        border: 1px solid #e5e7eb;
        transition: all 0.2s;
      }

      .layer-item.selected {
        background: #ede9fe;
        border-color: #6600ff;
      }

      .layer-item:hover {
        border-color: #d1d5db;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
      }

      .drag-handle {
        background: none;
        border: none;
        cursor: grab;
        padding: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #9ca3af;
        transition: color 0.2s;
      }

      .drag-handle:hover {
        color: #6600ff;
      }

      .drag-handle:active {
        cursor: grabbing;
      }

      .visibility-toggle {
        background: none;
        border: none;
        cursor: pointer;
        padding: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #6b7280;
        transition: color 0.2s;
      }

      .visibility-toggle:hover {
        color: #6600ff;
      }

      .layer-name {
        flex: 1;
        cursor: pointer;
        font-size: 14px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        background: none;
        border: none;
        text-align: left;
        padding: 0;
        color: inherit;
      }

      .layer-name:hover {
        text-decoration: underline;
      }

      .layer-z-index {
        font-size: 11px;
        color: #9ca3af;
        font-family: 'Courier New', monospace;
        padding: 2px 6px;
        background: #f3f4f6;
        border-radius: 3px;
      }

      .delete-button {
        background: none;
        border: none;
        cursor: pointer;
        padding: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #ef4444;
        transition: all 0.2s;
      }

      .delete-button:hover {
        color: #dc2626;
        background: #fee2e2;
        border-radius: 4px;
      }

      .element-edit-form {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
      }

      .field-row {
        display: grid;
        grid-template-columns: 1fr;
        gap: var(--boxel-sp);
      }

      .range-control {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }

      .range-value {
        min-width: 60px;
        text-align: right;
        font-size: var(--boxel-font-sm);
        color: var(--boxel-600);
        font-weight: 500;
      }

      .element-info {
        font-size: 14px;
        color: var(--boxel-700);
        margin: 12px 0;
      }

      .note {
        font-size: 12px;
        color: var(--boxel-500);
        font-style: italic;
        margin: 8px 0;
      }
    </style>
  </template>
}

export class YouTubeThumbnailComposer extends CardDef {
  static displayName = 'YouTube Thumbnail Composer';
  static icon = ImageIcon;
  static prefersWideFormat = true;

  @field title = contains(StringField);
  @field width = contains(NumberField);
  @field height = contains(NumberField);
  @field background = contains(BackgroundElement);
  @field textElements = containsMany(TextElement);
  @field visualElements = containsMany(VisualElement);
  @field previewMode = contains(StringField);
  @field showGrid = contains(BooleanField);
  @field selectedElementId = contains(StringField);

  static isolated = Isolated;
}
