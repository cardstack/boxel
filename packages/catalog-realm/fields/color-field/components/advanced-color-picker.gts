import Component from '@glimmer/component';
import type Owner from '@ember/owner';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { concat } from '@ember/helper';
import { not, eq, or, subtract } from '@cardstack/boxel-ui/helpers';
import { BoxelSelect, BoxelInput } from '@cardstack/boxel-ui/components';
import { htmlSafe } from '@ember/template';
import PipetteIcon from '@cardstack/boxel-icons/pipette';

import type { ColorFieldConfiguration } from '../util/color-utils';
import { parseCssColor, parseCssColorSafe } from '../util/color-utils';
import {
  detectColorFormat,
  RichColorFormat,
  hexToRgba,
  hsvToRgb,
  RGBA,
  rgbaToFormatString,
  rgbaToHexString,
  rgbaToHsl,
  rgbaToHsv,
  rgbaToRgbaString,
} from '@cardstack/boxel-ui/helpers';
import type { ColorFieldSignature } from '../util/color-field-signature';
import { setupElement } from '../modifiers/setup-element-modifier';

export default class AdvancedColorPicker extends Component<ColorFieldSignature> {
  // ========== Properties ==========
  @tracked h: number = 0;
  @tracked s: number = 100;
  @tracked v: number = 100;
  @tracked a: number = 1;

  @tracked isDraggingSV = false;
  @tracked inputValue = '';
  @tracked hexInputValue = '';
  @tracked cssInputValue = '';
  @tracked selectedFormat: RichColorFormat | null = null; // User-selected format (null = auto-detect)

  svCanvasElement: HTMLCanvasElement | null = null;
  private lastModelValue: string | null | undefined = null;

  // Cache for rgba computation to avoid recomputation during drag
  private cachedRgba: RGBA | null = null;
  private cachedHsv: { h: number; s: number; v: number; a: number } | null =
    null;

  // ========== Getters ==========
  get eyeDropperSupported(): boolean {
    return typeof (window as any).EyeDropper !== 'undefined';
  }

  get availableFormats(): RichColorFormat[] {
    return ['hex', 'rgb', 'hsl', 'hsb', 'css'];
  }

  get formatOptions() {
    return this.availableFormats.map((format) => ({
      label: format.toUpperCase(),
      value: format,
    }));
  }

  get defaultFormat(): RichColorFormat {
    const options = (
      this.args.configuration as ColorFieldConfiguration & {
        variant: 'advanced';
      }
    )?.options;
    return options?.defaultFormat ?? 'hex';
  }

  // Simple getter - no persistence, just detect when needed
  get outputFormat(): RichColorFormat {
    // If user selected a format, use it
    if (this.selectedFormat) {
      return this.selectedFormat;
    }

    // Otherwise auto-detect from model
    if (typeof this.args.model === 'string') {
      const detected = detectColorFormat(this.args.model);
      if (detected && this.availableFormats.includes(detected)) {
        return detected;
      }
    }

    return this.defaultFormat;
  }

  get selectedFormatOption() {
    return (
      this.formatOptions.find((opt) => opt.value === this.outputFormat) ||
      this.formatOptions[0]
    );
  }

  get shouldShowFormatSelector(): boolean {
    return true;
  }

  get rgba(): RGBA {
    // Cache rgba computation during drag to avoid expensive recomputation
    if (this.cachedRgba && this.cachedHsv) {
      const currentHsv = { h: this.h, s: this.s, v: this.v, a: this.a };
      if (
        this.cachedHsv.h === currentHsv.h &&
        this.cachedHsv.s === currentHsv.s &&
        this.cachedHsv.v === currentHsv.v &&
        this.cachedHsv.a === currentHsv.a
      ) {
        return this.cachedRgba;
      }
    }

    // Compute and cache
    const rgb = hsvToRgb({ h: this.h, s: this.s, v: this.v });
    this.cachedRgba = { ...rgb, a: this.a };
    this.cachedHsv = { h: this.h, s: this.s, v: this.v, a: this.a };
    return this.cachedRgba;
  }

  get hsv() {
    // During drag, skip sync entirely for performance - just return current values
    if (this.isDraggingSV) {
      return { h: this.h, s: this.s, v: this.v };
    }

    // Sync from model when not dragging - ensures we update when model changes externally
    // (e.g., when selecting a recent color)
    this.syncFromModel();
    return { h: this.h, s: this.s, v: this.v };
  }

  get rgbValues() {
    const { r, g, b } = this.rgba;
    return {
      r: Math.round(r),
      g: Math.round(g),
      b: Math.round(b),
    };
  }

  get hslValues() {
    const hsl = rgbaToHsl(this.rgba);
    return {
      h: Math.round(hsl.h),
      s: Math.round(hsl.s),
      l: Math.round(hsl.l),
    };
  }

  get hueGradient(): string {
    return 'linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)';
  }

  getColorString = (format: RichColorFormat): string => {
    return rgbaToFormatString(this.rgba, format);
  };

  // ========== Private Helper Methods ==========
  private syncFromModel() {
    const modelValue = this.args.model;

    // Only update if model actually changed and we're not dragging
    if (modelValue === this.lastModelValue || this.isDraggingSV) {
      return;
    }

    this.lastModelValue = modelValue;

    if (modelValue) {
      const rgba = parseCssColor(modelValue);
      this.updateHSVFromRgba(rgba);
      this.syncInputValues();
      // Redraw canvas when model changes
      requestAnimationFrame(() => {
        this.drawSVCanvas();
      });
    } else {
      // Default fallback
      const rgba = parseCssColor('#3b82f6');
      this.updateHSVFromRgba(rgba);
      this.syncInputValues();
      requestAnimationFrame(() => {
        this.drawSVCanvas();
      });
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

  private saveColor(rgba: RGBA, format?: RichColorFormat) {
    if (!this.isRgbaValid(rgba)) {
      return;
    }
    const targetFormat = format ?? this.outputFormat;
    const colorValue = rgbaToFormatString(rgba, targetFormat);
    // Update lastModelValue BEFORE calling set to prevent sync during drag
    // When debounced save completes, lastModelValue will already match
    this.lastModelValue = colorValue;
    // @set is now always the immediate handler (handleColorChangeImmediate)
    this.args.set?.(colorValue);
  }

  private syncInputValues() {
    this.inputValue = this.getColorString(this.outputFormat);
    this.hexInputValue = rgbaToHexString(this.rgba).toUpperCase();
    this.cssInputValue = rgbaToRgbaString(this.rgba);
  }

  private updateHSVFromRgba(rgba: RGBA) {
    const hsv = rgbaToHsv(rgba);
    this.h = hsv.h;
    this.s = hsv.s;
    this.v = hsv.v;
    this.a = rgba.a;
    // Clear cache when HSV values are updated externally
    this.cachedRgba = null;
    this.cachedHsv = null;
  }

  private drawSVCanvas() {
    if (!this.svCanvasElement) return;
    const canvas = this.svCanvasElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    const satGradient = ctx.createLinearGradient(0, 0, width, 0);
    satGradient.addColorStop(0, 'white');
    satGradient.addColorStop(1, `hsl(${this.hsv.h}, 100%, 50%)`);
    ctx.fillStyle = satGradient;
    ctx.fillRect(0, 0, width, height);

    const valGradient = ctx.createLinearGradient(0, 0, 0, height);
    valGradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
    valGradient.addColorStop(1, 'rgba(0, 0, 0, 1)');
    ctx.fillStyle = valGradient;
    ctx.fillRect(0, 0, width, height);
  }

  // ========== Private Event Handlers ==========
  private windowPointerMoveHandler = (event: PointerEvent) => {
    if (this.isDraggingSV) {
      this.handleSVInteraction(event);
    }
  };

  private windowPointerUpHandler = () => {
    if (this.isDraggingSV) {
      this.commitColor();
    }

    this.isDraggingSV = false;
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
  setupSVCanvas(element: HTMLCanvasElement) {
    if (this.svCanvasElement && this.svCanvasElement !== element) {
      this.svCanvasElement.removeEventListener(
        'pointerdown',
        this.handleSVMouseDown,
      );
    }
    this.svCanvasElement = element;
    element.addEventListener('pointerdown', this.handleSVMouseDown);
    requestAnimationFrame(() => {
      this.drawSVCanvas();
      this.syncFromModel();
      this.syncInputValues();
    });
  }

  @action
  updateInputValue() {
    // Sync from model before updating
    this.syncFromModel();

    if (document.activeElement?.tagName !== 'INPUT') {
      this.inputValue = this.getColorString(this.outputFormat);
    }
  }

  @action
  handleSVMouseDown(event: PointerEvent) {
    if (!this.args.canEdit) return;
    this.isDraggingSV = true;
    this.handleSVInteraction(event);
    this.addWindowListeners();
  }

  @action
  handleSVInteraction(event: PointerEvent) {
    if (!this.svCanvasElement || !this.args.canEdit) return;
    const rect = this.svCanvasElement.getBoundingClientRect();
    const x = Math.max(0, Math.min(event.clientX - rect.left, rect.width));
    const y = Math.max(0, Math.min(event.clientY - rect.top, rect.height));

    this.s = (x / rect.width) * 100;
    this.v = 100 - (y / rect.height) * 100;
  }

  @action
  commitColor() {
    if (!this.args.canEdit) return;
    // Save color when drag ends - triggers color change
    this.saveColor(this.rgba);
    // Clear cache after saving
    this.cachedRgba = null;
    this.cachedHsv = null;
    // NOW sync input values after drag ends
    this.syncInputValues();
  }

  @action
  handleHueInput(value: string | number) {
    if (!this.args.canEdit) return;
    const newValue = Number(value);
    if (Number.isNaN(newValue)) return;
    this.h = newValue;

    // Redraw canvas when h changes - canvas gradient depends on h
    requestAnimationFrame(() => {
      this.drawSVCanvas();
    });
  }

  @action
  handleHueChange() {
    if (!this.args.canEdit) return;
    // Save when hue slider change completes - triggers color change
    this.commitColor();
  }

  @action
  handleFormatSelect(option: { label: string; value: RichColorFormat } | null) {
    if (!option) return;
    // Just update format - DON'T save color
    if (this.selectedFormat === option.value) {
      return;
    }
    this.selectedFormat = option.value;
    // Persist the current color using the newly selected format
    this.saveColor(this.rgba);
    // Update input value to show new format
    this.syncInputValues();
  }

  @action
  handleHexInput(value: string) {
    if (!this.args.canEdit) return;
    this.hexInputValue = value;
  }

  @action
  handleColorInput(value: string) {
    this.inputValue = value;
  }

  @action
  handleCssInput(value: string) {
    this.cssInputValue = value;
  }

  private handleColorKeyPressInternal(
    inputValue: string,
    format: RichColorFormat,
    event: KeyboardEvent,
  ) {
    if (!this.args.canEdit) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      const { rgba, valid } = parseCssColorSafe(inputValue);
      if (valid) {
        this.updateHSVFromRgba(rgba);
        // Save color immediately on Enter - triggers immediate color change
        this.saveColor(rgba, format);
        this.syncInputValues();
        // Redraw canvas after updating HSV
        requestAnimationFrame(() => {
          this.drawSVCanvas();
        });
        // Blur the input to provide visual feedback
        (event.target as HTMLInputElement)?.blur();
      } else {
        // Revert to model value
        this.syncFromModel();
      }
    }
  }

  @action
  handleHexKeyPress(event: KeyboardEvent) {
    this.handleColorKeyPressInternal(this.hexInputValue, 'hex', event);
  }

  @action
  handleColorKeyPress(event: KeyboardEvent) {
    this.handleColorKeyPressInternal(this.inputValue, this.outputFormat, event);
  }

  @action
  handleCssKeyPress(event: KeyboardEvent) {
    this.handleColorKeyPressInternal(
      this.cssInputValue,
      this.outputFormat,
      event,
    );
  }

  @action
  handleHexBlur(_event: Event) {
    if (!this.args.canEdit) return;

    const { rgba, valid } = parseCssColorSafe(this.hexInputValue);
    if (valid) {
      this.updateHSVFromRgba(rgba);
      // Save color immediately on blur - triggers immediate color change
      this.saveColor(rgba, 'hex');
      this.syncInputValues();
      // Redraw canvas after updating HSV
      requestAnimationFrame(() => {
        this.drawSVCanvas();
      });
    } else {
      // Revert to model value
      this.syncFromModel();
    }
  }

  @action
  handleColorBlur(_event: Event) {
    if (!this.args.canEdit) return;

    const { rgba, valid } = parseCssColorSafe(this.inputValue);
    if (valid) {
      this.updateHSVFromRgba(rgba);
      // Save color immediately on blur - triggers immediate color change
      this.saveColor(rgba, this.outputFormat);
      this.syncInputValues();
      // Redraw canvas after updating HSV
      requestAnimationFrame(() => {
        this.drawSVCanvas();
      });
    } else {
      // Revert to model value
      this.syncFromModel();
    }
  }

  @action
  handleCssBlur(_event: Event) {
    if (!this.args.canEdit) return;

    const { rgba, valid } = parseCssColorSafe(this.cssInputValue);
    if (valid) {
      this.updateHSVFromRgba(rgba);
      // Save color immediately on blur - triggers immediate color change
      this.saveColor(rgba, this.outputFormat);
      this.syncInputValues();
      // Redraw canvas after updating HSV
      requestAnimationFrame(() => {
        this.drawSVCanvas();
      });
    } else {
      // Revert to model value
      this.syncFromModel();
    }
  }

  @action
  async handleEyeDropper() {
    if (!this.args.canEdit || !this.eyeDropperSupported) return;

    try {
      const EyeDropper = (window as any).EyeDropper;
      const eyeDropper = new EyeDropper();
      const result = await eyeDropper.open();

      if (result && result.sRGBHex) {
        const pickedRgba = hexToRgba(result.sRGBHex);
        const newRgba = { ...pickedRgba, a: this.rgba.a };
        this.updateHSVFromRgba(newRgba);
        // Save color - triggers color change
        this.saveColor(newRgba, 'hex');
        this.syncInputValues();
        requestAnimationFrame(() => {
          this.drawSVCanvas();
        });
      }
    } catch (error) {
      console.log('Eyedropper cancelled or error:', error);
    }
  }

  // ========== Lifecycle ==========
  constructor(owner: Owner, args: ColorFieldSignature['Args']) {
    super(owner, args);
    // Minimal initialization - just sync HSV from model
    const rgba = parseCssColor(this.args.model || '#3b82f6');
    const hsv = rgbaToHsv(rgba);
    this.h = hsv.h;
    this.s = hsv.s;
    this.v = hsv.v;
    this.a = rgba.a;
    this.lastModelValue = this.args.model;
  }

  willDestroy() {
    super.willDestroy();
    this.removeWindowListeners();
    this.svCanvasElement?.removeEventListener(
      'pointerdown',
      this.handleSVMouseDown,
    );
  }

  <template>
    <div class='advanced-color-editor'>
      <div class='canvas-container'>
        <canvas
          width='300'
          height='200'
          class='sv-canvas'
          {{setupElement this.setupSVCanvas}}
        ></canvas>
        <div
          class='cursor-indicator'
          style={{htmlSafe
            (concat 'left:' this.s '%;' 'top:' (subtract 100 this.v) '%;')
          }}
        ></div>
      </div>

      <div class='hue-slider-container'>
        <BoxelInput
          @type='range'
          @min='0'
          @max='360'
          @step='1'
          @value={{this.h}}
          class='hue-slider'
          style={{htmlSafe (concat 'background: ' this.hueGradient)}}
          @onInput={{this.handleHueInput}}
          @onChange={{this.handleHueChange}}
          @disabled={{not @canEdit}}
        />
      </div>

      <div class='controls'>
        {{#if (or this.shouldShowFormatSelector this.eyeDropperSupported)}}
          <div class='format-switch' data-color-canvas-ignore-drag>
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
            {{#if this.eyeDropperSupported}}
              <button
                type='button'
                {{on 'click' this.handleEyeDropper}}
                disabled={{not @canEdit}}
                title='Pick color from screen'
                class='eyedropper-button'
              >
                <PipetteIcon />
              </button>
            {{/if}}
          </div>
        {{/if}}

        {{#if (eq this.outputFormat 'css')}}
          <BoxelInput
            class='color-css-input'
            @value={{this.cssInputValue}}
            @placeholder='e.g., blue, rgb(255,0,0), hsl(120,100%,50%)'
            @onInput={{this.handleCssInput}}
            @onBlur={{this.handleCssBlur}}
            @onKeyPress={{this.handleCssKeyPress}}
            @disabled={{not @canEdit}}
          />
        {{else if (eq this.outputFormat 'rgb')}}
          <BoxelInput
            class='color-value-input'
            @value={{this.inputValue}}
            @placeholder='rgb(255, 255, 255)'
            @onInput={{this.handleColorInput}}
            @onBlur={{this.handleColorBlur}}
            @onKeyPress={{this.handleColorKeyPress}}
            @disabled={{not @canEdit}}
          />
        {{else if (eq this.outputFormat 'hsl')}}
          <BoxelInput
            class='color-value-input'
            @value={{this.inputValue}}
            @placeholder='hsl(0, 100%, 50%)'
            @onInput={{this.handleColorInput}}
            @onBlur={{this.handleColorBlur}}
            @onKeyPress={{this.handleColorKeyPress}}
            @disabled={{not @canEdit}}
          />
        {{else if (eq this.outputFormat 'hsb')}}
          <BoxelInput
            class='color-value-input'
            @value={{this.inputValue}}
            @placeholder='hsb(0, 100%, 100%)'
            @onInput={{this.handleColorInput}}
            @onBlur={{this.handleColorBlur}}
            @onKeyPress={{this.handleColorKeyPress}}
            @disabled={{not @canEdit}}
          />
        {{else}}
          <BoxelInput
            class='color-hex-input'
            @value={{this.hexInputValue}}
            @placeholder='#3b82f6'
            @onInput={{this.handleHexInput}}
            @onBlur={{this.handleHexBlur}}
            @onKeyPress={{this.handleHexKeyPress}}
            @disabled={{not @canEdit}}
          />
        {{/if}}
      </div>
    </div>

    <style scoped>
      .advanced-color-editor {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        padding: 0.5rem;
        border: 1px solid var(--border, #e2e8f0);
        border-radius: var(--radius, 0.5rem);
        transition: background 0.2s;
        background: var(--card, #ffffff);
        box-shadow: var(--shadow-md, 0 4px 6px -1px rgb(0 0 0 / 0.1));
      }

      .canvas-container {
        position: relative;
        width: 100%;
        border-radius: calc(var(--radius, 0.5rem));
        overflow: hidden;
        border: 1px solid var(--border, #e5e7eb);
        box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.05);
      }

      .sv-canvas {
        width: 100%;
        height: auto;
        display: block;
        cursor: crosshair;
      }

      .cursor-indicator {
        position: absolute;
        width: 0.875rem;
        height: 0.875rem;
        background: var(--background, #ffffff);
        border: 2px solid var(--foreground, #000000);
        border-radius: 50%;
        pointer-events: none;
        transform: translate(-50%, -50%);
        box-shadow:
          0 0 0 1.5px var(--background, #ffffff),
          0 2px 4px rgba(0, 0, 0, 0.2);
        transition: none;
      }

      .hue-slider-container {
        width: 100%;
      }

      .hue-slider {
        width: 100%;
        --boxel-input-height: 0.5rem;
        -webkit-appearance: none;
        appearance: none;
        border-radius: calc(var(--radius, 0.5rem));
        outline: none;
        cursor: pointer;
        border: 1px solid var(--border, #e2e8f0);
        padding: 0;
      }

      .hue-slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 1rem;
        height: 1rem;
        background: var(--background, #ffffff);
        border: 2px solid var(--foreground, #000000);
        border-radius: 50%;
        cursor: pointer;
        box-shadow:
          0 0 0 1.5px var(--background, #ffffff),
          0 2px 4px rgba(0, 0, 0, 0.2);
      }

      .hue-slider::-moz-range-thumb {
        width: 1rem;
        height: 1rem;
        background: var(--background, #ffffff);
        border: 2px solid var(--foreground, #000000);
        border-radius: 50%;
        cursor: pointer;
        box-shadow:
          0 0 0 1.5px var(--background, #ffffff),
          0 2px 4px rgba(0, 0, 0, 0.2);
      }

      .hue-slider:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .controls {
        display: flex;
        flex-direction: column;
        gap: 0.625rem;
      }

      .format-switch {
        display: flex;
        gap: 0.5rem;
        align-items: center;
      }

      .mode-select {
        flex: 1;
        min-width: 9rem;
      }

      .eyedropper-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0.625rem;
        background: var(--secondary, #f1f5f9);
        border: 1px solid var(--border, #e2e8f0);
        border-radius: calc(var(--radius, 0.5rem) * 0.75);
        cursor: pointer;
        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        color: var(--foreground, #0f172a);
      }

      .eyedropper-button:hover:not(:disabled) {
        background: var(--accent, #f0f9ff);
        border-color: var(--ring, #3b82f6);
        color: var(--accent-foreground, #1e293b);
        transform: translateY(-1px);
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.08);
      }

      .eyedropper-button:active:not(:disabled) {
        transform: translateY(0) scale(0.96);
      }

      .eyedropper-button:disabled {
        cursor: not-allowed;
        opacity: 0.4;
      }

      .eyedropper-button svg {
        width: 1.25rem;
        height: 1.25rem;
      }
    </style>
  </template>
}
