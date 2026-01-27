import Component from '@glimmer/component';
import type Owner from '@ember/owner';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { concat } from '@ember/helper';
import { htmlSafe } from '@ember/template';

import { parseCssColor } from '../util/color-utils';
import type {
  WheelColorFormat,
  WheelVariantConfiguration,
} from '../util/color-utils';
import {
  detectColorFormat,
  hslToRgb,
  RGBA,
  rgbaToFormatString,
  rgbaToHsv,
} from '@cardstack/boxel-ui/helpers';
import type { ColorFieldSignature } from '../util/color-field-signature';
import { setupElement } from '../modifiers/setup-element-modifier';

export default class ColorWheelPicker extends Component<ColorFieldSignature> {
  // ========== Properties ==========
  @tracked h: number = 0;
  @tracked isDragging = false;

  wheelCanvasElement: HTMLCanvasElement | null = null;
  containerElement: HTMLElement | null = null;
  private lastModelValue: string | null | undefined = null;
  private resizeObserver: ResizeObserver | null = null;
  private pendingInteractionFrame: number | null = null;
  private pendingInteractionEvent: PointerEvent | null = null;

  // Wheel dimensions - read from CSS variable
  @tracked private size = 280;

  private getSizeFromCSS(): number {
    if (!this.containerElement) return 280;
    const computedStyle = getComputedStyle(this.containerElement);
    const sizeValue = computedStyle
      .getPropertyValue('--color-wheel-size')
      .trim();
    if (sizeValue) {
      // Parse the value (e.g., "280px" -> 280)
      const parsed = parseFloat(sizeValue);
      if (!isNaN(parsed) && parsed > 0) {
        return parsed;
      }
    }
    return 280; // Default fallback
  }

  private updateSize() {
    const newSize = this.getSizeFromCSS();
    if (newSize !== this.size) {
      this.size = newSize;
      // Update canvas size and redraw the wheel when size changes
      this.updateCanvasSize();
    }
  }

  private get centerX() {
    return this.size / 2;
  }
  private get centerY() {
    return this.size / 2;
  }
  private get outerRadius() {
    return this.size / 2 - 10;
  }
  private get innerRadius() {
    return this.size / 2 - 40;
  }

  // ========== Getters ==========
  get configuredDefaultFormat(): WheelColorFormat {
    const options = (this.args.configuration as WheelVariantConfiguration)
      ?.options;
    return options?.defaultFormat ?? 'hex';
  }

  get outputFormat(): WheelColorFormat {
    const options = (this.args.configuration as WheelVariantConfiguration)
      ?.options;

    if (options?.defaultFormat) {
      return options.defaultFormat;
    }

    if (this.args.model) {
      const format = detectColorFormat(this.args.model);
      if (format === 'hex' || format === 'rgb' || format === 'hsl') {
        return format as WheelColorFormat;
      }
    }

    return 'hex';
  }

  get currentHue(): number {
    // Skip sync check during dragging for better performance
    if (!this.isDragging) {
      this.ensureSyncedWithModel();
    }
    return this.h;
  }

  get currentColor(): string {
    // Use this.h directly instead of this.currentHue to avoid getter overhead
    return `hsl(${this.h}, 100%, 50%)`;
  }

  get thumbPosition() {
    // Calculate position based on current hue
    // Use this.h directly to avoid getter overhead during dragging
    const angle = ((this.h - 90) * Math.PI) / 180;
    const radius = (this.innerRadius + this.outerRadius) / 2;
    return {
      x: this.centerX + Math.cos(angle) * radius,
      y: this.centerY + Math.sin(angle) * radius,
    };
  }

  // ========== Private Helper Methods ==========
  private ensureSyncedWithModel(): void {
    // Don't sync while actively dragging
    if (this.isDragging) {
      return;
    }

    const currentModel = this.args.model;

    // Only sync if the model value actually changed
    if (currentModel !== this.lastModelValue) {
      this.syncHueFromModel();
    }
  }

  private syncHueFromModel() {
    const modelValue = this.args.model;

    this.lastModelValue = modelValue;

    if (modelValue) {
      const rgba = parseCssColor(modelValue);
      const hsv = rgbaToHsv(rgba);
      // Round hue to integer for consistency
      this.h = Math.round(hsv.h);
    } else {
      // Default fallback
      const rgba = parseCssColor('#3b82f6');
      const hsv = rgbaToHsv(rgba);
      this.h = Math.round(hsv.h);
    }
  }

  private isRgbaValid(rgba: RGBA): boolean {
    return (
      Number.isFinite(rgba.r) &&
      Number.isFinite(rgba.g) &&
      Number.isFinite(rgba.b) &&
      Number.isFinite(rgba.a)
    );
  }

  private saveColor(rgba: RGBA) {
    if (!this.isRgbaValid(rgba)) {
      return;
    }
    const colorValue = rgbaToFormatString(rgba, this.outputFormat);
    this.args.set?.(colorValue);
  }

  private getHueFromPosition(clientX: number, clientY: number): number | null {
    if (!this.containerElement) return null;
    const rect = this.containerElement.getBoundingClientRect();
    const x = clientX - rect.left - this.centerX;
    const y = clientY - rect.top - this.centerY;

    const distance = Math.sqrt(x * x + y * y);

    if (distance < this.innerRadius || distance > this.outerRadius) {
      return null;
    }

    let angle = (Math.atan2(y, x) * 180) / Math.PI + 90;
    if (angle < 0) angle += 360;

    return angle;
  }

  private drawColorWheel() {
    if (!this.wheelCanvasElement) return;
    const canvas = this.wheelCanvasElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, this.size, this.size);

    for (let angle = 0; angle < 360; angle += 0.5) {
      const startAngle = ((angle - 90) * Math.PI) / 180;
      const endAngle = ((angle + 0.5 - 90) * Math.PI) / 180;

      ctx.beginPath();
      ctx.arc(
        this.centerX,
        this.centerY,
        this.outerRadius,
        startAngle,
        endAngle,
      );
      ctx.arc(
        this.centerX,
        this.centerY,
        this.innerRadius,
        endAngle,
        startAngle,
        true,
      );
      ctx.closePath();
      ctx.fillStyle = `hsl(${angle}, 100%, 50%)`;
      ctx.fill();
    }
  }

  // ========== Private Event Handlers ==========
  private windowPointerMoveHandler = (event: PointerEvent) => {
    if (this.isDragging) {
      // Store the latest event and throttle updates using requestAnimationFrame
      this.pendingInteractionEvent = event;
      if (this.pendingInteractionFrame === null) {
        this.pendingInteractionFrame = requestAnimationFrame(() => {
          if (this.pendingInteractionEvent) {
            this.handleWheelInteraction(this.pendingInteractionEvent);
            this.pendingInteractionEvent = null;
          }
          this.pendingInteractionFrame = null;
        });
      }
    }
  };

  private windowPointerUpHandler = () => {
    // Cancel any pending interaction frame
    if (this.pendingInteractionFrame !== null) {
      cancelAnimationFrame(this.pendingInteractionFrame);
      this.pendingInteractionFrame = null;
    }
    this.pendingInteractionEvent = null;

    if (this.isDragging) {
      this.commitColor();
    }

    this.isDragging = false;
    this.removeWindowListeners();
  };

  private addWindowListeners() {
    window.addEventListener('pointermove', this.windowPointerMoveHandler);
    window.addEventListener('pointerup', this.windowPointerUpHandler);
  }

  private removeWindowListeners() {
    window.removeEventListener('pointermove', this.windowPointerMoveHandler);
    window.removeEventListener('pointerup', this.windowPointerUpHandler);
  }

  // ========== Action Methods ==========
  @action
  setupContainer(element: HTMLElement) {
    // If it's the same element, don't re-setup
    if (this.containerElement === element) {
      return;
    }

    // Clean up old container
    if (this.containerElement) {
      this.containerElement.removeEventListener(
        'pointerdown',
        this.handleWheelMouseDown,
      );
    }

    // Clean up old ResizeObserver
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    this.containerElement = element;
    element.addEventListener('pointerdown', this.handleWheelMouseDown);

    // Initialize size from CSS variable
    this.updateSize();

    // Watch for size changes (including CSS variable changes)
    this.resizeObserver = new ResizeObserver(() => {
      this.updateSize();
    });
    this.resizeObserver.observe(element);
  }

  @action
  setupWheelCanvas(element: HTMLCanvasElement) {
    this.wheelCanvasElement = element;
    // Ensure we have the latest size (in case container was set up first)
    if (this.containerElement) {
      this.updateSize();
    }
    // Set initial canvas size
    element.width = this.size;
    element.height = this.size;
    requestAnimationFrame(() => this.drawColorWheel());
  }

  private updateCanvasSize() {
    if (this.wheelCanvasElement) {
      this.wheelCanvasElement.width = this.size;
      this.wheelCanvasElement.height = this.size;
      requestAnimationFrame(() => this.drawColorWheel());
    }
  }

  @action
  handleWheelMouseDown(event: PointerEvent) {
    if (!this.args.canEdit) return;
    const newHue = this.getHueFromPosition(event.clientX, event.clientY);
    if (newHue !== null) {
      // Round hue to integer
      this.h = Math.round(newHue);
      this.isDragging = true;
      this.addWindowListeners();
    }
  }

  @action
  handleWheelInteraction(event: PointerEvent) {
    if (!this.args.canEdit) return;
    const newHue = this.getHueFromPosition(event.clientX, event.clientY);
    if (newHue !== null) {
      // Round hue to integer
      this.h = Math.round(newHue);
    }
  }

  @action
  commitColor() {
    if (!this.args.canEdit) return;

    // Convert current hue to RGB
    const rgb = hslToRgb({ h: this.h, s: 100, l: 50 });
    const rgba: RGBA = { ...rgb, a: 1 };
    this.saveColor(rgba);
  }

  // ========== Lifecycle ==========
  constructor(owner: Owner, args: ColorFieldSignature['Args']) {
    super(owner, args);
    // Initialize hue from model
    this.syncHueFromModel();
  }

  willDestroy() {
    super.willDestroy();
    // Cancel any pending interaction frame
    if (this.pendingInteractionFrame !== null) {
      cancelAnimationFrame(this.pendingInteractionFrame);
      this.pendingInteractionFrame = null;
    }
    this.removeWindowListeners();
    this.containerElement?.removeEventListener(
      'pointerdown',
      this.handleWheelMouseDown,
    );
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
  }

  <template>
    <div class='color-wheel-editor' {{setupElement this.setupContainer}}>
      <canvas
        class='color-wheel-canvas'
        {{setupElement this.setupWheelCanvas}}
      ></canvas>
      <div
        class='wheel-thumb'
        style={{htmlSafe
          (concat
            'left:'
            this.thumbPosition.x
            'px;top:'
            this.thumbPosition.y
            'px;background-color:'
            this.currentColor
          )
        }}
      ></div>
    </div>

    <style scoped>
      .color-wheel-editor {
        position: relative;
        width: var(--color-wheel-size, 280px);
        height: var(--color-wheel-size, 280px);
        touch-action: none;
        user-select: none;
      }

      .color-wheel-canvas {
        width: 100%;
        height: 100%;
        display: block;
        cursor: pointer;
      }

      .wheel-thumb {
        position: absolute;
        width: 1.75rem;
        height: 1.75rem;
        border-radius: 50%;
        border: 4px solid white;
        pointer-events: none;
        transform: translate(-50%, -50%);
        box-shadow:
          0 0 0 1px rgba(0, 0, 0, 0.1),
          0 2px 4px rgba(0, 0, 0, 0.2);
        transition: none;
      }
    </style>
  </template>
}
