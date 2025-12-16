import Component from '@glimmer/component';
import type Owner from '@ember/owner';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { concat } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import { not } from '@cardstack/boxel-ui/helpers';
import { BoxelSelect, BoxelInput } from '@cardstack/boxel-ui/components';

import type {
  ColorFieldConfiguration,
  ColorFormat,
  RGBA,
} from '../util/color-utils';
import {
  detectColorFormat,
  parseCssColor,
  parseCssColorSafe,
  rgbaToHsvValues,
  rgbaToFormat,
  hslToRgb,
  rgbToHex,
} from '../util/color-utils';
import type { ColorFieldSignature } from '../util/color-field-signature';
import { setupElement } from '../modifiers/setup-element-modifier';

export default class ColorWheelEdit extends Component<ColorFieldSignature> {
  @tracked h: number = 0;
  @tracked isDragging = false;
  @tracked outputFormat: ColorFormat = 'hex';
  @tracked colorInputValue = '';
  @tracked isValueInputFocused = false;
  formatOptions: { label: string; value: ColorFormat }[] = [];

  get selectedFormatOption() {
    return (
      this.formatOptions.find((opt) => opt.value === this.outputFormat) ||
      this.formatOptions[0]
    );
  }

  get shouldShowFormatSelector(): boolean {
    const options = (
      this.args.configuration as ColorFieldConfiguration & {
        variant: 'wheel';
      }
    )?.options;
    // If explicitly set, use that value
    if (options?.showFormatSelector !== undefined) {
      return options.showFormatSelector;
    }
    // Default: show when multiple formats available
    return this.availableFormats.length > 1;
  }

  wheelCanvasElement: HTMLCanvasElement | null = null;
  containerElement: HTMLElement | null = null;

  size = 280;
  centerX = this.size / 2;
  centerY = this.size / 2;
  outerRadius = this.size / 2 - 10;
  innerRadius = this.size / 2 - 40;

  get availableFormats(): ColorFormat[] {
    const options = (
      this.args.configuration as ColorFieldConfiguration & {
        variant: 'wheel';
      }
    )?.options;
    const formats = options?.allowedFormats ?? ['hex', 'rgb', 'hsl', 'hsb'];
    // Safety: Prevent empty array from breaking component
    return formats.length > 0 ? formats : ['hex'];
  }

  get defaultFormat(): ColorFormat {
    const options = (
      this.args.configuration as ColorFieldConfiguration & {
        variant: 'wheel';
      }
    )?.options;
    return options?.defaultFormat ?? 'hex';
  }

  constructor(owner: Owner, args: any) {
    super(owner, args);
    const rgba = parseCssColor(this.args.model || '#3b82f6');
    const hsv = rgbaToHsvValues(rgba);
    this.h = hsv.h;

    this.outputFormat = this.defaultFormat;
    this.formatOptions = this.availableFormats.map((format) => ({
      label: format.toUpperCase(),
      value: format,
    }));
    this.colorInputValue = this.colorValue;
  }

  get currentColor(): string {
    return `hsl(${this.h}, 100%, 50%)`;
  }

  get colorValue(): string {
    const rgb = hslToRgb(this.h, 100, 50);
    switch (this.outputFormat) {
      case 'hex':
        return rgbToHex(rgb.r, rgb.g, rgb.b);
      case 'rgb':
        return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
      case 'hsl':
        return `hsl(${Math.round(this.h)}, 100%, 50%)`;
      case 'hsb':
        return `hsb(${Math.round(this.h)}, 100%, 100%)`;
      default:
        return rgbToHex(rgb.r, rgb.g, rgb.b);
    }
  }

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

  drawColorWheel() {
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

  getHueFromPosition(clientX: number, clientY: number): number | null {
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

  @action
  handleWheelInteraction(event: PointerEvent) {
    if (!this.args.canEdit) return;
    const newHue = this.getHueFromPosition(event.clientX, event.clientY);
    if (newHue !== null) {
      this.h = newHue;
      this.updateColor();
    }
  }

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

  @action
  handleWheelMouseDown(event: PointerEvent) {
    if (!this.args.canEdit) return;
    const newHue = this.getHueFromPosition(event.clientX, event.clientY);
    if (newHue !== null) {
      this.h = newHue;
      this.isDragging = true;
      this.updateColor();
      this.addWindowListeners();
    }
  }

  willDestroy() {
    super.willDestroy();
    this.removeWindowListeners();
    this.containerElement?.removeEventListener(
      'pointerdown',
      this.handleWheelMouseDown,
    );
  }

  @action
  updateColor() {
    if (!this.isDragging) {
      const rgb = hslToRgb(this.h, 100, 50);
      const rgba = { ...rgb, a: 1 };
      const colorValue = rgbaToFormat(rgba, this.outputFormat);
      this.args.set?.(colorValue);
      this.refreshInputValue();
    }
  }

  @action
  commitColor() {
    const rgb = hslToRgb(this.h, 100, 50);
    const rgba = { ...rgb, a: 1 };
    const colorValue = rgbaToFormat(rgba, this.outputFormat);
    this.args.set?.(colorValue);
    this.refreshInputValue();
  }

  @action
  handleFormatSelect(option: { label: string; value: ColorFormat } | null) {
    if (!option) return;
    this.outputFormat = option.value;
    this.refreshInputValue();
  }

  @action
  handleValueInput(value: string) {
    this.colorInputValue = value;
    const trimmed = value.trim();
    if (!trimmed) return;

    const { rgba, valid } = parseCssColorSafe(trimmed);
    if (!valid) return;

    const detected = detectColorFormat(trimmed);
    const targetFormat =
      detected !== 'css' && this.availableFormats.includes(detected)
        ? detected
        : this.outputFormat;
    if (targetFormat !== this.outputFormat && detected !== 'css') {
      this.outputFormat = targetFormat;
    }

    this.setHueFromRgba(rgba);
    const colorValue = rgbaToFormat(rgba, targetFormat);
    this.args.set?.(colorValue);
  }

  @action
  handleValueFocus() {
    this.isValueInputFocused = true;
  }

  @action
  handleValueBlur() {
    this.isValueInputFocused = false;
    this.refreshInputValue();
  }

  refreshInputValue() {
    if (!this.isValueInputFocused) {
      this.colorInputValue = this.colorValue;
    }
  }

  setHueFromRgba(rgba: RGBA) {
    const hsv = rgbaToHsvValues(rgba);
    this.h = hsv.h;
  }

  get thumbPosition() {
    const angle = ((this.h - 90) * Math.PI) / 180;
    const radius = (this.innerRadius + this.outerRadius) / 2;
    return {
      x: this.centerX + Math.cos(angle) * radius,
      y: this.centerY + Math.sin(angle) * radius,
    };
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

      <div class='wheel-controls' data-color-canvas-ignore-drag>
        <div class='control-row'>
          {{#if this.shouldShowFormatSelector}}
            <BoxelSelect
              @placeholder='Format'
              @options={{this.formatOptions}}
              @selected={{this.selectedFormatOption}}
              @onChange={{this.handleFormatSelect}}
              @disabled={{not @canEdit}}
              class='mode-select'
              as |option|
            >
              {{option.label}}
            </BoxelSelect>
          {{/if}}

          <div class='color-value-field'>
            <BoxelInput
              class='color-value-input'
              @value={{this.colorInputValue}}
              @placeholder={{this.colorValue}}
              @onInput={{this.handleValueInput}}
              @onFocus={{this.handleValueFocus}}
              @onBlur={{this.handleValueBlur}}
              @disabled={{not @canEdit}}
            />
          </div>
        </div>
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

      .wheel-controls {
        display: flex;
        width: 100%;
        max-width: 420px;
      }

      .control-row {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        width: 100%;
        padding: 0.5rem 0.75rem;
        background: var(--muted, #f9fafb);
        border-radius: calc(var(--radius, 0.5rem));
        border: 1px solid var(--border, #e5e7eb);
      }

      .mode-select {
        flex: 0 0 7rem;
        min-width: 7rem;
      }

      .color-value-field {
        flex: 1 1 0;
        min-width: 0;
      }

      .color-value-input {
        width: 100%;
        padding: 0.5rem 1rem;
        font-family: var(--font-mono, monospace);
        font-size: 0.875rem;
        background: var(--muted, #f9fafb);
        border: 1px solid var(--border, #d1d5db);
        border-radius: calc(var(--radius, 0.5rem));
        color: var(--foreground, #0f172a);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .color-value-input:focus {
        outline: none;
        border-color: var(--primary, #3b82f6);
        box-shadow: 0 0 0 3px var(--ring, rgba(59, 130, 246, 0.1));
        background: var(--background, #ffffff);
      }

      :deep(.ember-basic-dropdown-content-wormhole-origin) {
        position: absolute;
      }
    </style>
  </template>
}
