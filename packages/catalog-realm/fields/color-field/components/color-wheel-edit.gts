import Component from '@glimmer/component';
import type Owner from '@ember/owner';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { concat } from '@ember/helper';
import { htmlSafe } from '@ember/template';

import {
  parseCssColor,
  rgbaToHsvValues,
  hslToRgb,
  detectColorFormat,
  rgbaToFormat,
} from '../util/color-utils';
import type {
  WheelColorFormat,
  WheelVariantConfiguration,
  RGBA,
} from '../util/color-utils';
import type { ColorFieldSignature } from '../util/color-field-signature';
import { setupElement } from '../modifiers/setup-element-modifier';

export default class ColorWheelEdit extends Component<ColorFieldSignature> {
  // ========== Properties ==========
  @tracked h: number = 0;
  @tracked isDragging = false;

  wheelCanvasElement: HTMLCanvasElement | null = null;
  containerElement: HTMLElement | null = null;
  private lastModelValue: string | null | undefined = null;

  // Wheel dimensions
  private readonly size = 280;
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
    // Sync hue from model when not dragging
    if (!this.isDragging) {
      this.syncHueFromModel();
    }
    return this.h;
  }

  get currentColor(): string {
    return `hsl(${this.currentHue}, 100%, 50%)`;
  }

  get thumbPosition() {
    // Sync hue from model before calculating position
    this.syncHueFromModel();
    const angle = ((this.h - 90) * Math.PI) / 180;
    const radius = (this.innerRadius + this.outerRadius) / 2;
    return {
      x: this.centerX + Math.cos(angle) * radius,
      y: this.centerY + Math.sin(angle) * radius,
    };
  }

  // ========== Private Helper Methods ==========
  private syncHueFromModel() {
    const modelValue = this.args.model;

    // Only update if model actually changed and we're not dragging
    if (modelValue === this.lastModelValue || this.isDragging) {
      return;
    }

    this.lastModelValue = modelValue;

    if (modelValue) {
      const rgba = parseCssColor(modelValue);
      const hsv = rgbaToHsvValues(rgba);
      this.h = hsv.h;
    } else {
      // Default fallback
      const rgba = parseCssColor('#3b82f6');
      const hsv = rgbaToHsvValues(rgba);
      this.h = hsv.h;
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
    const colorValue = rgbaToFormat(rgba, this.outputFormat);
    this.args.set?.(colorValue);
    this.lastModelValue = colorValue;
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
      this.handleWheelInteraction(event);
    }
  };

  private windowPointerUpHandler = () => {
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
    if (this.containerElement && this.containerElement !== element) {
      this.containerElement.removeEventListener(
        'pointerdown',
        this.handleWheelMouseDown,
      );
    }
    this.containerElement = element;
    element.addEventListener('pointerdown', this.handleWheelMouseDown);
  }

  @action
  setupWheelCanvas(element: HTMLCanvasElement) {
    this.wheelCanvasElement = element;
    requestAnimationFrame(() => this.drawColorWheel());
  }

  @action
  handleWheelMouseDown(event: PointerEvent) {
    if (!this.args.canEdit) return;
    const newHue = this.getHueFromPosition(event.clientX, event.clientY);
    if (newHue !== null) {
      this.h = newHue;
      this.isDragging = true;
      this.addWindowListeners();
    }
  }

  @action
  handleWheelInteraction(event: PointerEvent) {
    if (!this.args.canEdit) return;
    const newHue = this.getHueFromPosition(event.clientX, event.clientY);
    if (newHue !== null) {
      this.h = newHue;
    }
  }

  @action
  commitColor() {
    if (!this.args.canEdit) return;

    // Convert current hue to RGB
    const rgb = hslToRgb(this.h, 100, 50);
    const rgba: RGBA = { ...rgb, a: 1 };
    this.saveColor(rgba);
  }

  // ========== Lifecycle ==========
  constructor(owner: Owner, args: ColorFieldSignature['Args']) {
    super(owner, args);
    // Initialize hue from model - will be synced via getters
    this.syncHueFromModel();
  }

  willDestroy() {
    super.willDestroy();
    this.removeWindowListeners();
    this.containerElement?.removeEventListener(
      'pointerdown',
      this.handleWheelMouseDown,
    );
  }

  <template>
    <div class='color-wheel-editor'>
      <div class='wheel-container' {{setupElement this.setupContainer}}>
        <canvas
          width={{this.size}}
          height={{this.size}}
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
    </div>

    <style scoped>
      .color-wheel-editor {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 1.5rem;
        padding: 1.5rem;
        background: var(--background, #ffffff);
        border-radius: calc(var(--radius, 0.5rem) * 1.5);
        border: 1px solid var(--border, #e5e7eb);
      }

      .wheel-container {
        position: relative;
        width: 280px;
        height: 280px;
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
