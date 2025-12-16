import Component from '@glimmer/component';
import type Owner from '@ember/owner';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { concat, fn } from '@ember/helper';
import {
  not,
  eq,
  or,
  multiply,
  divide,
  subtract,
} from '@cardstack/boxel-ui/helpers';
import { BoxelSelect, BoxelInput } from '@cardstack/boxel-ui/components';
import { htmlSafe } from '@ember/template';
import PipetteIcon from '@cardstack/boxel-icons/pipette';

import type {
  ColorFieldConfiguration,
  ColorFormat,
  RGBA,
} from '../util/color-utils';
import {
  parseCssColor,
  parseCssColorSafe,
  detectColorFormat,
  hexToRgba,
  rgbaToHex,
  rgbaToRgbaString,
  rgbaToHsvValues,
  hsvToRgb,
  rgbaToHslValues,
  hslToRgb,
  rgbaToFormat,
} from '../util/color-utils';
import type { ColorFieldSignature } from '../util/color-field-signature';
import { setupElement } from '../modifiers/setup-element-modifier';

export default class AdvancedEdit extends Component<ColorFieldSignature> {
  @tracked h: number = 0;
  @tracked s: number = 100;
  @tracked v: number = 100;
  @tracked a: number = 1;

  @tracked outputFormat: ColorFormat = 'css';
  @tracked isDraggingSV = false;
  @tracked isDraggingAlpha = false;
  @tracked inputValue = '';
  formatOptions: { label: string; value: ColorFormat }[] = [];

  get eyeDropperSupported(): boolean {
    return typeof (window as any).EyeDropper !== 'undefined';
  }

  svCanvasElement: HTMLCanvasElement | null = null;
  alphaCanvasElement: HTMLCanvasElement | null = null;

  get availableFormats(): ColorFormat[] {
    const options = (
      this.args.configuration as ColorFieldConfiguration & {
        variant: 'advanced';
      }
    )?.options;
    const formats = options?.allowedFormats ?? [
      'hex',
      'rgb',
      'hsl',
      'hsb',
      'css',
    ];
    // Safety: Prevent empty array from breaking component
    return formats.length > 0 ? formats : ['hex'];
  }

  get defaultFormat(): ColorFormat {
    const options = (
      this.args.configuration as ColorFieldConfiguration & {
        variant: 'advanced';
      }
    )?.options;
    return options?.defaultFormat ?? 'hex';
  }

  get selectedFormatOption() {
    return (
      this.formatOptions.find((opt) => opt.value === this.outputFormat) ||
      this.formatOptions[0]
    );
  }

  get shouldShowFormatSelector(): boolean {
    const options = (
      this.args.configuration as ColorFieldConfiguration & {
        variant: 'advanced';
      }
    )?.options;
    // If explicitly set, use that value
    if (options?.showFormatSelector !== undefined) {
      return options.showFormatSelector;
    }
    // Default: show when multiple formats available
    return this.availableFormats.length > 1;
  }

  constructor(owner: Owner, args: any) {
    super(owner, args);
    const detectedFormat =
      typeof this.args.model === 'string'
        ? detectColorFormat(this.args.model)
        : null;
    const fallbackFormat = this.availableFormats.includes(this.defaultFormat)
      ? this.defaultFormat
      : this.availableFormats[0];
    const initialFormat =
      detectedFormat && this.availableFormats.includes(detectedFormat)
        ? detectedFormat
        : fallbackFormat;
    this.formatOptions = this.availableFormats.map((format) => ({
      label: format.toUpperCase(),
      value: format,
    }));
    this.outputFormat = initialFormat;

    const rgba = parseCssColor(this.args.model);
    const hsv = rgbaToHsvValues(rgba);
    this.h = hsv.h;
    this.s = hsv.s;
    this.v = hsv.v;
    this.a = rgba.a;

    this.inputValue = this.getColorString(this.outputFormat);
    this.hexInputValue = this.args.model || '';
    this.cssInputValue = this.args.model || '';
  }

  get rgba(): RGBA {
    const rgb = hsvToRgb(this.h, this.s, this.v);
    return { ...rgb, a: this.a };
  }

  get hsv() {
    return { h: this.h, s: this.s, v: this.v };
  }

  get currentColor(): string {
    const rgb = this.rgba;
    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${rgb.a})`;
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
    const hsl = rgbaToHslValues(this.rgba);
    return {
      h: Math.round(hsl.h),
      s: Math.round(hsl.s),
      l: Math.round(hsl.l),
    };
  }

  getColorString = (format: ColorFormat): string => {
    return rgbaToFormat(this.rgba, format);
  };

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
      if (this.alphaCanvasElement) {
        this.drawAlphaCanvas();
      }
      this.updateInputValue();
    });
  }

  @action
  setupAlphaCanvas(element: HTMLCanvasElement) {
    this.alphaCanvasElement = element;
    requestAnimationFrame(() => {
      this.drawAlphaCanvas();
    });
  }

  @action
  updateInputValue() {
    if (document.activeElement?.tagName !== 'INPUT') {
      this.inputValue = this.getColorString(this.outputFormat);
    }
  }

  drawSVCanvas() {
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

  drawAlphaCanvas() {
    if (!this.alphaCanvasElement) return;
    const canvas = this.alphaCanvasElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);

    const squareSize = 4;
    for (let y = 0; y < height; y += squareSize) {
      for (let x = 0; x < width; x += squareSize) {
        ctx.fillStyle =
          (x / squareSize + y / squareSize) % 2 === 0 ? '#fff' : '#ccc';
        ctx.fillRect(x, y, squareSize, squareSize);
      }
    }

    try {
      const rgb = this.rgba;
      if (
        rgb &&
        typeof rgb.r === 'number' &&
        typeof rgb.g === 'number' &&
        typeof rgb.b === 'number'
      ) {
        const gradient = ctx.createLinearGradient(0, 0, width, 0);
        gradient.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`);
        gradient.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 1)`);
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
      }
    } catch (e) {
      const gradient = ctx.createLinearGradient(0, 0, width, 0);
      gradient.addColorStop(0, 'rgba(59, 130, 246, 0)');
      gradient.addColorStop(1, 'rgba(59, 130, 246, 1)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
    }
  }

  @action
  handleSVInteraction(event: PointerEvent) {
    if (!this.svCanvasElement || !this.args.canEdit) return;
    const rect = this.svCanvasElement.getBoundingClientRect();
    const x = Math.max(0, Math.min(event.clientX - rect.left, rect.width));
    const y = Math.max(0, Math.min(event.clientY - rect.top, rect.height));

    this.s = (x / rect.width) * 100;
    this.v = 100 - (y / rect.height) * 100;

    this.updateColorFromHSV();
    this.drawAlphaCanvas();
  }

  @action
  handleAlphaInteraction(event: PointerEvent) {
    if (!this.alphaCanvasElement || !this.args.canEdit) return;
    const rect = this.alphaCanvasElement.getBoundingClientRect();
    const x = Math.max(0, Math.min(event.clientX - rect.left, rect.width));
    this.a = parseFloat((x / rect.width).toFixed(2));

    const newRgba = { ...this.rgba, a: this.a };
    const newColor = rgbaToFormat(newRgba, this.outputFormat);
    this.inputValue = newColor;

    if (!this.isDraggingAlpha) {
      this.args.set?.(newColor);
    }

    this.drawAlphaCanvas();
  }

  private windowPointerMoveHandler = (event: PointerEvent) => {
    if (this.isDraggingSV) {
      this.handleSVInteraction(event);
    } else if (this.isDraggingAlpha) {
      this.handleAlphaInteraction(event);
    }
  };

  private windowPointerUpHandler = () => {
    if (this.isDraggingSV || this.isDraggingAlpha) {
      this.commitColor();
    }

    this.isDraggingSV = false;
    this.isDraggingAlpha = false;
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
  handleSVMouseDown(event: PointerEvent) {
    if (!this.args.canEdit) return;
    this.isDraggingSV = true;
    this.handleSVInteraction(event);
    this.addWindowListeners();
  }

  @action
  handleAlphaMouseDown(event: PointerEvent) {
    if (!this.args.canEdit) return;
    this.isDraggingAlpha = true;
    this.handleAlphaInteraction(event);
    this.addWindowListeners();
  }

  willDestroy() {
    super.willDestroy();
    this.removeWindowListeners();
    this.svCanvasElement?.removeEventListener(
      'pointerdown',
      this.handleSVMouseDown,
    );
  }

  @action
  updateColorFromHSV() {
    const rgb = hsvToRgb(this.h, this.s, this.v);
    const newRgba = { ...rgb, a: this.a };
    const newColor = rgbaToFormat(newRgba, this.outputFormat);

    if (!this.isDraggingSV && !this.isDraggingAlpha) {
      this.args.set?.(newColor);
    }

    this.inputValue = newColor;

    if (this.outputFormat === 'hex') {
      this.hexInputValue = newColor;
    } else if (this.outputFormat === 'css') {
      this.cssInputValue = newColor;
    }

    this.updateInputValue();
  }

  @action
  commitColor() {
    const rgb = hsvToRgb(this.h, this.s, this.v);
    const newRgba = { ...rgb, a: this.a };
    const newColor = rgbaToFormat(newRgba, this.outputFormat);
    this.args.set?.(newColor);
    this.inputValue = newColor;
  }

  get hueGradient() {
    return 'linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)';
  }

  @action
  handleHueInput(value: string | number) {
    if (!this.args.canEdit) return;
    const newValue = Number(value);
    if (Number.isNaN(newValue)) return;
    this.h = newValue;
    const rgb = hsvToRgb(this.h, this.s, this.v);
    const newRgba = { ...rgb, a: this.a };
    const newColor = rgbaToFormat(newRgba, this.outputFormat);
    this.inputValue = newColor;
    requestAnimationFrame(() => {
      this.drawSVCanvas();
      this.drawAlphaCanvas();
    });
  }

  @action
  handleHueChange() {
    if (!this.args.canEdit) return;
    this.commitColor();
  }

  @action
  updateHSVFromRgba(rgba: RGBA) {
    const hsv = rgbaToHsvValues(rgba);
    this.h = hsv.h;
    this.s = hsv.s;
    this.v = hsv.v;
    this.a = rgba.a;
  }

  @action
  setColorFromRgba(rgba: RGBA, format?: ColorFormat) {
    this.updateHSVFromRgba(rgba);

    const targetFormat = format ?? this.outputFormat;
    const newColor = rgbaToFormat(rgba, targetFormat);
    this.args.set?.(newColor);
    this.inputValue = newColor;

    requestAnimationFrame(() => {
      this.drawSVCanvas();
      this.drawAlphaCanvas();
    });
  }

  @action
  handleFormatSelect(option: { label: string; value: ColorFormat } | null) {
    if (!option) return;
    this.outputFormat = option.value;
    const newColor = rgbaToFormat(this.rgba, option.value);
    this.inputValue = newColor;
  }

  @tracked hexInputValue = '';

  @action
  handleHexInput(value: string) {
    if (!this.args.canEdit) return;
    this.hexInputValue = value;

    const { rgba, valid } = parseCssColorSafe(value);
    if (valid) {
      this.updateHSVFromRgba(rgba);
      requestAnimationFrame(() => {
        this.drawSVCanvas();
        this.drawAlphaCanvas();
      });
    }
  }

  @action
  handleHexBlur() {
    if (!this.args.canEdit) return;
    const { rgba, valid } = parseCssColorSafe(this.hexInputValue);
    if (valid) {
      this.setColorFromRgba(rgba, 'hex');
      this.hexInputValue = rgbaToHex(rgba, rgba.a < 1);
    } else {
      this.hexInputValue = this.args.model || '';
      const currentRgba = parseCssColor(this.args.model);
      this.updateHSVFromRgba(currentRgba);
      requestAnimationFrame(() => {
        this.drawSVCanvas();
        this.drawAlphaCanvas();
      });
    }
  }

  @action
  handleRgbChannelInput(channel: 'r' | 'g' | 'b', event: Event) {
    const value = Number((event.target as HTMLInputElement).value);
    if (Number.isNaN(value)) return;
    const clamped = Math.max(0, Math.min(255, value));

    const rgb = hsvToRgb(this.h, this.s, this.v);
    const newRgba = { ...rgb, a: this.a, [channel]: clamped };

    this.updateHSVFromRgba(newRgba);

    const newColor = rgbaToFormat(newRgba, 'rgb');
    this.args.set?.(newColor);
    this.inputValue = newColor;
    this.outputFormat = 'rgb';

    requestAnimationFrame(() => {
      this.drawSVCanvas();
      this.drawAlphaCanvas();
    });
  }

  @action
  handleHslChannelInput(channel: 'h' | 's' | 'l', event: Event) {
    const value = Number((event.target as HTMLInputElement).value);
    if (Number.isNaN(value)) return;
    const limits = channel === 'h' ? [0, 360] : [0, 100];
    const clamped = Math.max(limits[0], Math.min(limits[1], value));
    const nextHsl = { ...this.hslValues, [channel]: clamped };
    const rgb = hslToRgb(nextHsl.h, nextHsl.s, nextHsl.l);
    this.outputFormat = 'hsl';
    this.setColorFromRgba({ ...rgb, a: this.rgba.a }, 'hsl');
  }

  @action
  handleColorInput(value: string) {
    this.inputValue = value;
    const { rgba, valid } = parseCssColorSafe(value);
    if (!valid) return;
    const detected = detectColorFormat(value);
    const targetFormat = detected === 'css' ? this.outputFormat : detected;
    if (targetFormat !== this.outputFormat) {
      this.outputFormat = targetFormat;
    }
    this.setColorFromRgba(rgba, targetFormat);
  }

  @tracked cssInputValue = '';

  @action
  handleUniversalInput(value: string) {
    if (!this.args.canEdit) return;
    this.cssInputValue = value;

    const { rgba, valid } = parseCssColorSafe(value);
    if (valid) {
      this.updateHSVFromRgba(rgba);
      requestAnimationFrame(() => {
        this.drawSVCanvas();
        this.drawAlphaCanvas();
      });
    }
  }

  @action
  handleCssBlur() {
    if (!this.args.canEdit) return;

    const trimmed = this.cssInputValue.trim();
    const { rgba, valid } = parseCssColorSafe(trimmed);
    if (valid) {
      const rgbaString = rgbaToRgbaString(rgba);
      this.args.set?.(rgbaString);
      this.cssInputValue = rgbaString;
      this.updateHSVFromRgba(rgba);
      requestAnimationFrame(() => {
        this.drawSVCanvas();
        this.drawAlphaCanvas();
      });
    } else {
      this.cssInputValue = this.args.model || '';
      const currentRgba = parseCssColor(this.args.model);
      this.updateHSVFromRgba(currentRgba);
      requestAnimationFrame(() => {
        this.drawSVCanvas();
        this.drawAlphaCanvas();
      });
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
        this.setColorFromRgba(newRgba);
      }
    } catch (error) {
      console.log('Eyedropper cancelled or error:', error);
    }
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
            (concat
              'left:'
              (multiply (divide this.hsv.s 100) 100)
              '%;'
              'top:'
              (subtract 100 (multiply (divide this.hsv.v 100) 100))
              '%;'
            )
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
          <div class='input-row'>
            <label class='field full'>
              <span>CSS Color</span>
              <BoxelInput
                class='color-css-input'
                @value={{this.cssInputValue}}
                @placeholder='e.g., blue, rgb(255,0,0), hsl(120,100%,50%)'
                @onInput={{this.handleUniversalInput}}
                @onBlur={{this.handleCssBlur}}
                @disabled={{not @canEdit}}
              />
            </label>
          </div>
        {{else if (eq this.outputFormat 'rgb')}}
          <div class='input-row triple'>
            <label class='field'>
              <span>R</span>
              <input
                type='number'
                min='0'
                max='255'
                value={{this.rgbValues.r}}
                {{on 'input' (fn this.handleRgbChannelInput 'r')}}
                {{on 'blur' this.updateInputValue}}
                disabled={{not @canEdit}}
              />
            </label>
            <label class='field'>
              <span>G</span>
              <input
                type='number'
                min='0'
                max='255'
                value={{this.rgbValues.g}}
                {{on 'input' (fn this.handleRgbChannelInput 'g')}}
                {{on 'blur' this.updateInputValue}}
                disabled={{not @canEdit}}
              />
            </label>
            <label class='field'>
              <span>B</span>
              <input
                type='number'
                min='0'
                max='255'
                value={{this.rgbValues.b}}
                {{on 'input' (fn this.handleRgbChannelInput 'b')}}
                {{on 'blur' this.updateInputValue}}
                disabled={{not @canEdit}}
              />
            </label>
          </div>
        {{else if (eq this.outputFormat 'hsl')}}
          <div class='input-row triple'>
            <label class='field'>
              <span>H</span>
              <input
                type='number'
                min='0'
                max='360'
                value={{this.hslValues.h}}
                {{on 'input' (fn this.handleHslChannelInput 'h')}}
                {{on 'blur' this.updateInputValue}}
                disabled={{not @canEdit}}
              />
            </label>
            <label class='field'>
              <span>S</span>
              <input
                type='number'
                min='0'
                max='100'
                value={{this.hslValues.s}}
                {{on 'input' (fn this.handleHslChannelInput 's')}}
                {{on 'blur' this.updateInputValue}}
                disabled={{not @canEdit}}
              />
            </label>
            <label class='field'>
              <span>L</span>
              <input
                type='number'
                min='0'
                max='100'
                value={{this.hslValues.l}}
                {{on 'input' (fn this.handleHslChannelInput 'l')}}
                {{on 'blur' this.updateInputValue}}
                disabled={{not @canEdit}}
              />
            </label>
          </div>
        {{else if (eq this.outputFormat 'hsb')}}
          <div class='input-row'>
            <label class='field full'>
              <span>HSB Color</span>
              <BoxelInput
                class='color-value-input'
                @value={{this.inputValue}}
                @placeholder='hsb(0, 100%, 100%)'
                @onInput={{this.handleColorInput}}
                @onBlur={{this.updateInputValue}}
                @disabled={{not @canEdit}}
              />
            </label>
          </div>
        {{else}}
          <div class='input-row'>
            <label class='field full'>
              <span>HEX</span>
              <BoxelInput
                class='color-hex-input'
                @value={{this.hexInputValue}}
                @placeholder='#3b82f6'
                @onInput={{this.handleHexInput}}
                @onBlur={{this.handleHexBlur}}
                @disabled={{not @canEdit}}
              />
            </label>
          </div>
        {{/if}}
      </div>
    </div>

    <style scoped>
      /* Advanced Editor Container - Clean Figma-like design */
      .advanced-color-editor {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        padding: 1rem;
        background: var(--background, #ffffff);
        border-radius: calc(var(--radius, 0.5rem) * 1.5);
        border: 1px solid var(--border, #e5e7eb);
      }

      /* Main Color Canvas - Clean and focused */
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

      /* Hue Slider - Figma-like refinement */
      .hue-slider-container {
        width: 100%;
        margin-bottom: 1rem;
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

      /* Controls Section - Compact and clean */
      .controls {
        display: flex;
        flex-direction: column;
        gap: 0.625rem;
      }

      .format-switch {
        display: flex;
        gap: 0.5rem;
        align-items: center;
        padding: 0.5rem 0.75rem;
        background: var(--muted, #f9fafb);
        border-radius: calc(var(--radius, 0.5rem));
        border: 1px solid var(--border, #e5e7eb);
      }

      .mode-select {
        flex: 1;
        min-width: 9rem;
      }

      /* Input Fields - Compact */
      .input-row {
        display: flex;
        gap: 0.5rem;
        width: 100%;
        padding: 0.625rem 0.75rem;
        background: var(--muted, #f9fafb);
        border-radius: calc(var(--radius, 0.5rem));
        border: 1px solid var(--border, #e5e7eb);
      }

      .input-row.triple .field {
        flex: 1;
      }

      .field {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        flex: 1;
      }

      .field.full {
        width: 100%;
      }

      .field span {
        font-size: 0.6875rem;
        font-weight: 600;
        color: var(--muted-foreground, #64748b);
        text-transform: uppercase;
        letter-spacing: 0.03em;
      }

      .field input {
        width: 100%;
        padding: 0.5rem 0.625rem;
        border-radius: calc(var(--radius, 0.5rem) * 0.75);
        border: 1px solid var(--input, #e2e8f0);
        background: var(--background, #ffffff);
        font-size: 0.8125rem;
        font-family: var(
          --font-mono,
          'SF Mono',
          'Monaco',
          'Courier New',
          monospace
        );
        color: var(--foreground, #0f172a);
        transition: all 0.15s ease;
      }

      .field input:hover:not(:disabled) {
        border-color: var(--ring, #94a3b8);
      }

      .field input:focus {
        outline: none;
        border-color: var(--primary, #3b82f6);
        box-shadow: 0 0 0 3px var(--ring, rgba(59, 130, 246, 0.1));
      }

      .field input:disabled {
        background: var(--muted, #f9fafb);
        color: var(--muted-foreground, #9ca3af);
        cursor: not-allowed;
        opacity: 0.6;
      }

      /* Eyedropper Button */
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
        background: var(--accent, #e0e7ff);
        border-color: var(--primary, #3b82f6);
        color: var(--primary, #3b82f6);
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

      /* Prevent layout shift when dropdown opens */
      :deep(.ember-basic-dropdown-content-wormhole-origin) {
        position: absolute;
      }
    </style>
  </template>
}
