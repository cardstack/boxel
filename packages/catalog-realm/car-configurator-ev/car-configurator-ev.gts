import {
  CardDef,
  FieldDef,
  Component,
  field,
  contains,
  containsMany,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import BooleanField from 'https://cardstack.com/base/boolean';
import UrlField from 'https://cardstack.com/base/url';
import { on } from '@ember/modifier';
import { BoxelButton, BoxelSelect } from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';
import { concat, fn } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import CarIcon from '@cardstack/boxel-icons/car';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';

// TypeScript interfaces for configuration options
interface ConfigOption {
  name: string;
  price: number;
  description: string;
  imageUrl: string;
  colorValue: string | null;
  isSelected: boolean;
}

interface ConfigSection {
  id: string;
  name: string;
  icon: string;
}

// Custom field for configuration options
export class ConfigOptionField extends FieldDef {
  static displayName = 'Configuration Option';
  @field name = contains(StringField);
  @field price = contains(NumberField);
  @field description = contains(StringField);
  @field imageUrl = contains(UrlField);
  @field colorValue = contains(StringField);
  @field isSelected = contains(BooleanField);
}

class CarConfiguratorEVIsolated extends Component<typeof CarConfiguratorEV> {
  @tracked selectedSection = 'color';

  get sections(): ConfigSection[] {
    return [
      { id: 'color', name: 'Exterior', icon: '🎨' },
      { id: 'trim', name: 'Trim', icon: '⚡' },
      { id: 'range', name: 'Range', icon: '🔋' },
      { id: 'wheels', name: 'Wheels', icon: '⚪' },
      { id: 'interior', name: 'Interior', icon: '🪑' },
      { id: 'features', name: 'Features', icon: '✨' },
    ];
  }

  getPriceDisplay(price: number | null): string {
    if (price == null) return '';
    return price === 0 ? 'Included' : `+${price.toLocaleString()}`;
  }

  getColorOptionClass(
    colorOption: ConfigOption,
    selectedColorName: string,
  ): string {
    return `color-option ${
      colorOption.name === selectedColorName ? 'selected' : ''
    }`;
  }

  getOptionCardClass(option: ConfigOption, selectedValue: string): string {
    return `option-card ${option.name === selectedValue ? 'selected' : ''}`;
  }

  @action
  toggleFeature(feature: string) {
    if (feature === 'autopilot')
      this.args.model.autopilotEnabled = !this.args.model.autopilotEnabled;
    else if (feature === 'audio')
      this.args.model.premiumAudioEnabled =
        !this.args.model.premiumAudioEnabled;
    else if (feature === 'sunroof')
      this.args.model.sunroofEnabled = !this.args.model.sunroofEnabled;
  }

  @action
  selectSection(sectionId: string) {
    if (this.selectedSection !== sectionId) {
      this.selectedSection = sectionId;
    }
  }

  @action
  selectColor(colorName: string, _colorValue: string) {
    const colorOption = this.args.model.colorOptions?.find(
      (opt) => opt.name === colorName,
    );
    if (colorOption) {
      this.args.model.selectedColor = colorOption;
    }
  }

  @action
  selectOption(optionType: string, optionName: string) {
    if (optionType === 'trim') {
      const trimOption = this.args.model.trimOptions?.find(
        (opt) => opt.name === optionName,
      );
      if (trimOption) this.args.model.selectedTrim = trimOption;
    } else if (optionType === 'range') {
      const rangeOption = this.args.model.rangeOptions?.find(
        (opt) => opt.name === optionName,
      );
      if (rangeOption) this.args.model.selectedRange = rangeOption;
    } else if (optionType === 'wheels') {
      const wheelOption = this.args.model.wheelOptions?.find(
        (opt) => opt.name === optionName,
      );
      if (wheelOption) this.args.model.selectedWheels = wheelOption;
    } else if (optionType === 'interior') {
      const interiorOption = this.args.model.interiorOptions?.find(
        (opt) => opt.name === optionName,
      );
      if (interiorOption) this.args.model.selectedInterior = interiorOption;
    }
  }

  <template>
    <div class='configurator-container'>
      <nav class='section-nav'>
        {{#each this.sections as |section|}}
          <button
            class='nav-button
              {{if (eq this.selectedSection section.id) "active"}}'
            {{on 'click' (fn this.selectSection section.id)}}
          >
            <span class='nav-icon'>{{section.icon}}</span>
            <span class='nav-label'>{{section.name}}</span>
          </button>
        {{/each}}
      </nav>

      <main class='configurator-main'>
        {{! Vehicle Preview }}
        <section
          class='vehicle-preview'
          style={{htmlSafe
            (concat
              'background: linear-gradient(135deg, '
              (if
                @model.selectedColor @model.selectedColor.colorValue '#3b82f6'
              )
              '22, #0a0a0a)'
            )
          }}
        >
          <div class='preview-content'>
            <div
              class='vehicle-silhouette'
              style={{htmlSafe
                (concat
                  'filter: drop-shadow(0 20px 40px '
                  (if
                    @model.selectedColor
                    @model.selectedColor.colorValue
                    '#3b82f6'
                  )
                  '99)'
                )
              }}
            >
              <svg viewBox='0 0 400 150' class='car-svg'>
                <path
                  d='M50,120 Q50,100 70,100 L120,100 Q130,80 140,80 L260,80 Q270,80 280,100 L330,100 Q350,100 350,120 L350,130 L320,130 Q320,140 310,140 L290,140 Q280,140 280,130 L120,130 Q120,140 110,140 L90,140 Q80,140 80,130 L50,130 Z'
                  fill={{if
                    @model.selectedColor
                    @model.selectedColor.colorValue
                    '#3b82f6'
                  }}
                  stroke='rgba(255,255,255,0.1)'
                  stroke-width='1'
                />
                {{! Windows }}
                <path
                  d='M140,80 L260,80 Q265,85 265,90 L135,90 Q140,85 140,80 Z'
                  fill='rgba(100,150,255,0.3)'
                />
                {{! Wheels }}
                <circle
                  cx='110'
                  cy='130'
                  r='15'
                  fill='#2a2a2a'
                  stroke='rgba(255,255,255,0.2)'
                  stroke-width='2'
                />
                <circle
                  cx='290'
                  cy='130'
                  r='15'
                  fill='#2a2a2a'
                  stroke='rgba(255,255,255,0.2)'
                  stroke-width='2'
                />
              </svg>
            </div>
            <h1 class='model-name'>{{@model.modelName}}</h1>
            <p class='model-specs'>{{if
                @model.selectedRange
                @model.selectedRange.name
                'Standard Range'
              }}
              •
              {{if
                @model.selectedTrim
                @model.selectedTrim.name
                'Standard Trim'
              }}</p>
          </div>
        </section>

        {{! Configuration Panel }}
        <section class='config-panel'>
          {{#if (eq this.selectedSection 'color')}}
            <div class='config-section'>
              <h2>Choose Your Color</h2>
              {{#if (eq @model.colorOptions.length 0)}}
                <div class='no-options'>
                  <p>No color options available</p>
                </div>
              {{else}}
                <div class='color-grid'>
                  {{#each @model.colorOptions as |colorOption|}}
                    <button
                      class={{this.getColorOptionClass
                        colorOption
                        (if @model.selectedColor @model.selectedColor.name '')
                      }}
                      {{on
                        'click'
                        (fn
                          this.selectColor
                          colorOption.name
                          colorOption.colorValue
                        )
                      }}
                    >
                      <div
                        class='color-swatch'
                        style={{htmlSafe
                          (concat 'background: ' colorOption.colorValue)
                        }}
                      ></div>
                      <span>{{colorOption.name}}</span>
                      <span class='price'>{{this.getPriceDisplay
                          colorOption.price
                        }}</span>
                    </button>
                  {{/each}}
                </div>
              {{/if}}
            </div>
          {{else if (eq this.selectedSection 'trim')}}
            <div class='config-section'>
              <h2>Select Trim Level</h2>
              {{#if (eq @model.trimOptions.length 0)}}
                <div class='no-options'>
                  <p>No trim options available</p>
                </div>
              {{else}}
                <div class='option-list'>
                  {{#each @model.trimOptions as |trimOption|}}
                    <button
                      class={{this.getOptionCardClass
                        trimOption
                        (if @model.selectedTrim @model.selectedTrim.name '')
                      }}
                      {{on
                        'click'
                        (fn this.selectOption 'trim' trimOption.name)
                      }}
                    >
                      <span class='option-title'>{{trimOption.name}}</span>
                      <p>{{trimOption.description}}</p>
                      <span class='price'>{{this.getPriceDisplay
                          trimOption.price
                        }}</span>
                    </button>
                  {{/each}}
                </div>
              {{/if}}
            </div>
          {{else if (eq this.selectedSection 'range')}}
            <div class='config-section'>
              <h2>Battery & Range</h2>
              {{#if (eq @model.rangeOptions.length 0)}}
                <div class='no-options'>
                  <p>No range options available</p>
                </div>
              {{else}}
                <div class='option-list'>
                  {{#each @model.rangeOptions as |rangeOption|}}
                    <button
                      class={{this.getOptionCardClass
                        rangeOption
                        (if @model.selectedRange @model.selectedRange.name '')
                      }}
                      {{on
                        'click'
                        (fn this.selectOption 'range' rangeOption.name)
                      }}
                    >
                      <span class='option-title'>{{rangeOption.name}}</span>
                      <p>{{rangeOption.description}}</p>
                      <span class='price'>{{this.getPriceDisplay
                          rangeOption.price
                        }}</span>
                    </button>
                  {{/each}}
                </div>
              {{/if}}
            </div>
          {{else if (eq this.selectedSection 'wheels')}}
            <div class='config-section'>
              <h2>Wheel Options</h2>
              {{#if (eq @model.wheelOptions.length 0)}}
                <div class='no-options'>
                  <p>No wheel options available</p>
                </div>
              {{else}}
                <div class='option-list'>
                  {{#each @model.wheelOptions as |wheelOption|}}
                    <button
                      class={{this.getOptionCardClass
                        wheelOption
                        (if @model.selectedWheels @model.selectedWheels.name '')
                      }}
                      {{on
                        'click'
                        (fn this.selectOption 'wheels' wheelOption.name)
                      }}
                    >
                      <span class='option-title'>{{wheelOption.name}}</span>
                      <p>{{wheelOption.description}}</p>
                      <span class='price'>{{this.getPriceDisplay
                          wheelOption.price
                        }}</span>
                    </button>
                  {{/each}}
                </div>
              {{/if}}
            </div>
          {{else if (eq this.selectedSection 'interior')}}
            <div class='config-section'>
              <h2>Interior Options</h2>
              {{#if (eq @model.interiorOptions.length 0)}}
                <div class='no-options'>
                  <p>No interior options available</p>
                </div>
              {{else}}
                <div class='option-list'>
                  {{#each @model.interiorOptions as |interiorOption|}}
                    <button
                      class={{this.getOptionCardClass
                        interiorOption
                        (if
                          @model.selectedInterior
                          @model.selectedInterior.name
                          ''
                        )
                      }}
                      {{on
                        'click'
                        (fn this.selectOption 'interior' interiorOption.name)
                      }}
                    >
                      <span class='option-title'>{{interiorOption.name}}</span>
                      <p>{{interiorOption.description}}</p>
                      <span class='price'>{{this.getPriceDisplay
                          interiorOption.price
                        }}</span>
                    </button>
                  {{/each}}
                </div>
              {{/if}}
            </div>
          {{else if (eq this.selectedSection 'features')}}
            <div class='config-section'>
              <h2>Premium Features</h2>
              <div class='feature-list'>
                <label
                  class='feature-toggle
                    {{if @model.autopilotEnabled "enabled"}}'
                >
                  <input
                    type='checkbox'
                    checked={{@model.autopilotEnabled}}
                    {{on 'change' (fn this.toggleFeature 'autopilot')}}
                  />
                  <div class='toggle-content'>
                    <h3>DreamDrive Pro</h3>
                    <p>Advanced driver assistance with highway autonomy</p>
                    <span class='price'>+$8,000</span>
                  </div>
                </label>
                <label
                  class='feature-toggle
                    {{if @model.premiumAudioEnabled "enabled"}}'
                >
                  <input
                    type='checkbox'
                    checked={{@model.premiumAudioEnabled}}
                    {{on 'change' (fn this.toggleFeature 'audio')}}
                  />
                  <div class='toggle-content'>
                    <h3>Surreal Sound Pro</h3>
                    <p>21-speaker immersive audio system</p>
                    <span class='price'>+$2,500</span>
                  </div>
                </label>
                <label
                  class='feature-toggle {{if @model.sunroofEnabled "enabled"}}'
                >
                  <input
                    type='checkbox'
                    checked={{@model.sunroofEnabled}}
                    {{on 'change' (fn this.toggleFeature 'sunroof')}}
                  />
                  <div class='toggle-content'>
                    <h3>Glass Canopy</h3>
                    <p>Panoramic glass roof with electrochromic dimming</p>
                    <span class='price'>+$1,500</span>
                  </div>
                </label>
              </div>
            </div>
          {{/if}}
        </section>
      </main>

      <aside class='price-summary'>
        <div class='summary-content'>
          <h3>{{@model.modelName}}</h3>

          <div class='summary-details'>
            <div class='detail-row'>
              <span>{{if
                  @model.selectedColor
                  @model.selectedColor.name
                  'Select Color'
                }}</span>
              <span>{{if
                  @model.selectedTrim
                  @model.selectedTrim.name
                  'Select Trim'
                }}</span>
            </div>
            <div class='detail-row'>
              <span>{{if
                  @model.selectedRange
                  @model.selectedRange.name
                  'Select Range'
                }}</span>
              <span>{{if
                  @model.selectedWheels
                  @model.selectedWheels.name
                  'Select Wheels'
                }}</span>
            </div>
            <div class='detail-row'>
              <span>{{if
                  @model.selectedInterior
                  @model.selectedInterior.name
                  'Select Interior'
                }}
                Interior</span>
            </div>
          </div>
          <div class='price-total'>
            <span class='total-label'>Total Price</span>
            <span class='total-amount'>$ {{@model.totalPrice}}</span>
          </div>

          <BoxelButton class='configure-button'>
            Reserve Now $1,000
          </BoxelButton>
        </div>
      </aside>
    </div>

    <style scoped>
      .configurator-container {
        --primary-bg: #0a0a0a;
        --secondary-bg: #1a1a1a;
        --accent-blue: #3b82f6;
        --text-primary: #ffffff;
        --text-secondary: #a3a3a3;
        --border-color: rgba(255, 255, 255, 0.1);
        --hover-bg: rgba(255, 255, 255, 0.05);

        display: grid;
        grid-template-columns: 240px 1fr 320px;
        grid-template-rows: 1fr;
        height: 100vh;
        background: var(--primary-bg);
        color: var(--text-primary);
        font-family:
          -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
        overflow: hidden;
      }

      /* Navigation */
      .section-nav {
        background: var(--secondary-bg);
        border-right: 1px solid var(--border-color);
        padding: 24px 0;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .nav-button {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 16px 24px;
        background: none;
        border: none;
        color: var(--text-secondary);
        cursor: pointer;
        transition: all 0.2s ease;
        position: relative;
      }

      .nav-button:hover {
        background: var(--hover-bg);
        color: var(--text-primary);
      }

      .nav-button.active {
        color: var(--accent-blue);
        background: rgba(59, 130, 246, 0.1);
      }

      .nav-button.active::before {
        content: '';
        position: absolute;
        left: 0;
        top: 0;
        bottom: 0;
        width: 3px;
        background: var(--accent-blue);
      }

      .nav-icon {
        font-size: 18px;
        width: 24px;
        text-align: center;
      }

      .nav-label {
        font-size: 14px;
        font-weight: 500;
      }

      /* Main Content */
      .configurator-main {
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      .vehicle-preview {
        height: 300px;
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
        background: linear-gradient(135deg, #1a1a1a22, #0a0a0a);
        border-bottom: 1px solid var(--border-color);
      }

      .preview-content {
        text-align: center;
        z-index: 1;
      }

      .vehicle-silhouette {
        margin-bottom: 24px;
      }

      .car-svg {
        width: 300px;
        height: auto;
        filter: drop-shadow(0 20px 50px rgba(59, 130, 246, 0.72));
      }

      .model-name {
        font-size: 28px;
        font-weight: 300;
        margin: 0 0 8px 0;
        letter-spacing: -0.5px;
      }

      .model-specs {
        color: var(--text-secondary);
        margin: 0;
        font-size: 14px;
      }

      /* Configuration Panel */
      .config-panel {
        flex: 1;
        overflow-y: auto;
        padding: 32px;
        transition: opacity 0.15s ease;
      }

      .config-panel.animating {
        opacity: 0.7;
      }

      .config-section h2 {
        font-size: 24px;
        font-weight: 300;
        margin: 0 0 24px 0;
        letter-spacing: -0.3px;
      }

      /* Color Grid */
      .color-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 16px;
      }

      .color-option {
        background: var(--secondary-bg);
        border: 1px solid var(--border-color);
        border-radius: 12px;
        padding: 20px;
        cursor: pointer;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
        transition: all 0.2s ease;
        color: var(--text-primary);
      }

      .color-option:hover {
        border-color: var(--accent-blue);
        transform: translateY(-2px);
      }

      .color-option.selected {
        border-color: var(--accent-blue);
        background: rgba(59, 130, 246, 0.1);
      }

      .color-swatch {
        width: 48px;
        height: 48px;
        border-radius: 50%;
        border: 2px solid var(--border-color);
      }

      .color-option span:first-of-type {
        font-weight: 500;
        font-size: 14px;
      }

      .color-option .price {
        font-size: 12px;
        color: var(--text-secondary);
      }

      .no-options {
        padding: 1rem 0;
        color: var(--text-secondary);
      }

      .no-options p {
        margin: 0;
        font-size: 14px;
      }

      /* Option List */
      .option-list {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .option-card {
        background: var(--secondary-bg);
        border: 1px solid var(--border-color);
        border-radius: 12px;
        padding: 20px;
        cursor: pointer;
        text-align: left;
        transition: all 0.2s ease;
        color: var(--text-primary);
      }

      .option-card:hover {
        border-color: var(--accent-blue);
        transform: translateY(-1px);
      }

      .option-card.selected {
        border-color: var(--accent-blue);
        background: rgba(59, 130, 246, 0.1);
      }

      .option-card h3 {
        margin: 0 0 8px 0;
        font-size: 16px;
        font-weight: 500;
      }

      .option-card p {
        margin: 0 0 12px 0;
        color: var(--text-secondary);
        font-size: 14px;
        line-height: 1.4;
      }

      .option-card .price {
        color: var(--accent-blue);
        font-weight: 500;
        font-size: 14px;
      }

      /* Feature List */
      .feature-list {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .feature-toggle {
        display: block;
        background: var(--secondary-bg);
        border: 1px solid var(--border-color);
        border-radius: 12px;
        padding: 20px;
        cursor: pointer;
        transition: all 0.2s ease;
        position: relative;
      }

      .feature-toggle:hover {
        border-color: var(--accent-blue);
      }

      .feature-toggle.enabled {
        border-color: var(--accent-blue);
        background: rgba(59, 130, 246, 0.1);
      }

      .feature-toggle input {
        position: absolute;
        opacity: 0;
      }

      .toggle-content h3 {
        margin: 0 0 8px 0;
        font-size: 16px;
        font-weight: 500;
      }

      .toggle-content p {
        margin: 0 0 12px 0;
        color: var(--text-secondary);
        font-size: 14px;
        line-height: 1.4;
      }

      .toggle-content .price {
        color: var(--accent-blue);
        font-weight: 500;
        font-size: 14px;
      }

      /* Price Summary */
      .price-summary {
        background: var(--secondary-bg);
        border-left: 1px solid var(--border-color);
        padding: 32px 24px;
        display: flex;
        flex-direction: column;
      }

      .summary-content {
        flex: 1;
      }

      .summary-content h3 {
        font-size: 18px;
        font-weight: 500;
        margin: 0 0 24px 0;
      }

      .summary-details {
        margin-bottom: 32px;
      }

      .detail-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;
        font-size: 14px;
        color: var(--text-secondary);
      }

      .price-total {
        border-top: 1px solid var(--border-color);
        padding-top: 20px;
        margin-bottom: 24px;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .total-label {
        font-size: 16px;
        color: var(--text-secondary);
      }

      .total-amount {
        font-size: 24px;
        font-weight: 600;
        color: var(--text-primary);
      }

      .configure-button {
        width: 100%;
        background: var(--accent-blue);
        color: white;
        border: none;
        border-radius: 8px;
        padding: 16px;
        font-size: 16px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .configure-button:hover {
        background: #2563eb;
        transform: translateY(-1px);
      }
    </style>
  </template>
}

class CardConfiguratorEvEdit extends Component<typeof CarConfiguratorEV> {
  @tracked isOptionsPanelCollapsed = true;

  get colorOptions(): ConfigOption[] {
    return this.args.model.colorOptions || [];
  }
  get trimOptions(): ConfigOption[] {
    return this.args.model.trimOptions || [];
  }
  get rangeOptions(): ConfigOption[] {
    return this.args.model.rangeOptions || [];
  }
  get wheelOptions(): ConfigOption[] {
    return this.args.model.wheelOptions || [];
  }
  get interiorOptions(): ConfigOption[] {
    return this.args.model.interiorOptions || [];
  }

  getPriceDisplay(price: number | null): string {
    if (price == null) return '';
    return price === 0 ? 'Included' : `+${price.toLocaleString()}`;
  }

  @action
  onColorChange(colorOption: ConfigOption) {
    this.args.model.selectedColor = new ConfigOptionField(colorOption);
  }

  @action
  onTrimChange(trimOption: ConfigOption) {
    this.args.model.selectedTrim = new ConfigOptionField(trimOption);
  }

  @action
  onRangeChange(rangeOption: ConfigOption) {
    this.args.model.selectedRange = new ConfigOptionField(rangeOption);
  }

  @action
  onWheelChange(wheelOption: ConfigOption) {
    this.args.model.selectedWheels = new ConfigOptionField(wheelOption);
  }

  @action
  onInteriorChange(interiorOption: ConfigOption) {
    this.args.model.selectedInterior = new ConfigOptionField(interiorOption);
  }

  @action
  toggleOptionsPanel() {
    this.isOptionsPanelCollapsed = !this.isOptionsPanelCollapsed;
  }

  get selectedColorOption(): ConfigOption | null {
    let selected = this.args.model.selectedColor;
    if (!selected || !selected.name) {
      return null;
    }
    return selected;
  }

  get selectedTrimOption(): ConfigOption | null {
    let selected = this.args.model.selectedTrim;
    if (!selected || !selected.name) {
      return null;
    }
    return selected;
  }

  get selectedRangeOption(): ConfigOption | null {
    let selected = this.args.model.selectedRange;
    if (!selected || !selected.name) {
      return null;
    }
    return selected;
  }

  get selectedWheelOption(): ConfigOption | null {
    let selected = this.args.model.selectedWheels;
    if (!selected || !selected.name) {
      return null;
    }
    return selected;
  }

  get selectedInteriorOption(): ConfigOption | null {
    let selected = this.args.model.selectedInterior;
    if (!selected || !selected.name) {
      return null;
    }
    return selected;
  }

  <template>
    <div class='edit-container'>
      <header class='edit-header'>
        <h2>🚗 EV Car Configurator</h2>
        <div class='price-display'>
          <span class='price-label'>Total Price:</span>
          <span class='price-amount'>&#36;{{@model.totalPrice}}</span>
        </div>
      </header>

      <div class='edit-layout {{if this.isOptionsPanelCollapsed "collapsed"}}'>
        {{! Left Column: Options Management }}
        <div class='options-panel'>
          <div class='options-panel-header'>
            <h3 class='panel-title'>📋 Available Options Management</h3>
            <button
              class='toggle-button
                {{if this.isOptionsPanelCollapsed "collapsed"}}'
              {{on 'click' this.toggleOptionsPanel}}
              title='{{if
                this.isOptionsPanelCollapsed
                "Expand Options Panel"
                "Collapse Options Panel"
              }}'
            >
              <svg
                class='toggle-icon'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <path d='M12 20h9' />
                <path
                  d='M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19.5 3 21l1.5-4L16.5 3.5z'
                />
              </svg>
            </button>
          </div>

          <div class='options-section'>
            <h4>🎨 Color Options</h4>
            <@fields.colorOptions @format='edit' />
          </div>

          <div class='options-section'>
            <h4>⚡ Trim Options</h4>
            <@fields.trimOptions @format='edit' />
          </div>

          <div class='options-section'>
            <h4>🔋 Range Options</h4>
            <@fields.rangeOptions @format='edit' />
          </div>

          <div class='options-section'>
            <h4>⚪ Wheel Options</h4>
            <@fields.wheelOptions @format='edit' />
          </div>

          <div class='options-section'>
            <h4>🪑 Interior Options</h4>
            <@fields.interiorOptions @format='edit' />
          </div>
        </div>

        {{! Right Column: Selected Configuration }}
        <div class='configuration-panel'>
          <h3 class='panel-title'>⚙️ Current Configuration</h3>

          {{! Basic Information }}
          <div class='config-section'>
            <h4>🚗 Basic Information</h4>
            <div class='config-field'>
              <label class='field-label'>Model Name</label>
              <@fields.modelName @format='edit' />
            </div>
            <div class='config-field'>
              <label class='field-label'>Base Price</label>
              <@fields.basePrice @format='edit' />
            </div>
          </div>

          {{! Exterior Configuration }}
          <div class='config-section'>
            <h4>🎨 Exterior Configuration</h4>
            <div class='config-field'>
              <label class='field-label'>Model Color</label>
              <BoxelSelect
                @options={{this.colorOptions}}
                @selected={{this.selectedColorOption}}
                @onChange={{this.onColorChange}}
                @placeholder='Select Color'
                @searchEnabled={{false}}
                class='config-select'
                as |colorOption|
              >
                <div class='select-option'>
                  <div
                    class='color-swatch-small'
                    style={{htmlSafe
                      (concat 'background: ' colorOption.colorValue)
                    }}
                  ></div>
                  <span>{{colorOption.name}}</span>
                </div>
              </BoxelSelect>
            </div>
          </div>

          {{! Performance Configuration }}
          <div class='config-section'>
            <h4>⚡ Performance Configuration</h4>
            <div class='config-field'>
              <label class='field-label'>Trim Level</label>
              <BoxelSelect
                @options={{this.trimOptions}}
                @selected={{this.selectedTrimOption}}
                @onChange={{this.onTrimChange}}
                @placeholder='Select Trim'
                @searchEnabled={{false}}
                class='config-select'
                as |trimOption|
              >
                <div class='select-option'>
                  <span>{{trimOption.name}}</span>
                </div>
              </BoxelSelect>
            </div>
            <div class='config-field'>
              <label class='field-label'>Battery Range</label>
              <BoxelSelect
                @options={{this.rangeOptions}}
                @selected={{this.selectedRangeOption}}
                @onChange={{this.onRangeChange}}
                @placeholder='Select Range'
                @searchEnabled={{false}}
                class='config-select'
                as |rangeOption|
              >
                <div class='select-option'>
                  <span>{{rangeOption.name}}</span>
                </div>
              </BoxelSelect>
            </div>
          </div>

          {{! Wheels & Tires }}
          <div class='config-section'>
            <h4>⚪ Wheels & Tires</h4>
            <div class='config-field'>
              <label class='field-label'>Wheel Style</label>
              <BoxelSelect
                @options={{this.wheelOptions}}
                @selected={{this.selectedWheelOption}}
                @onChange={{this.onWheelChange}}
                @placeholder='Select Wheels'
                @searchEnabled={{false}}
                class='config-select'
                as |wheelOption|
              >
                <div class='select-option'>
                  <span>{{wheelOption.name}}</span>
                </div>
              </BoxelSelect>
            </div>
          </div>

          {{! Interior Configuration }}
          <div class='config-section'>
            <h4>🪑 Interior Configuration</h4>
            <div class='config-field'>
              <label class='field-label'>Interior Style</label>
              <BoxelSelect
                @options={{this.interiorOptions}}
                @selected={{this.selectedInteriorOption}}
                @onChange={{this.onInteriorChange}}
                @placeholder='Select Interior'
                @searchEnabled={{false}}
                class='config-select'
                as |interiorOption|
              >
                <div class='select-option'>
                  <span>{{interiorOption.name}}</span>
                </div>
              </BoxelSelect>

            </div>
          </div>

          {{! Premium Features }}
          <div class='config-section'>
            <h4>✨ Premium Features</h4>

            <div class='config-field'>
              <label class='field-label'>DreamDrive Pro (Autopilot) - $8,000</label>
              <@fields.autopilotEnabled @format='edit' />
            </div>

            <div class='config-field'>
              <label class='field-label'>Surreal Sound Pro (Premium Audio) -
                $2,500</label>
              <@fields.premiumAudioEnabled @format='edit' />
            </div>

            <div class='config-field'>
              <label class='field-label'>Glass Canopy (Sunroof) - $1,500</label>
              <@fields.sunroofEnabled @format='edit' />
            </div>
          </div>
        </div>
      </div>
    </div>

    <style scoped>
      .edit-container {
        --primary-bg: #0a0a0a;
        --secondary-bg: #f8fafc;
        --accent-blue: #3b82f6;
        --accent-green: #10b981;
        --text-primary: #1e293b;
        --text-secondary: #64748b;
        --border-color: #e2e8f0;
        --hover-bg: #f1f5f9;
        --shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.05);
        --shadow-md:
          0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
        --shadow-lg:
          0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1);

        color: var(--text-primary);
        font-family:
          -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
        min-height: 100vh;
        padding: 0;
      }

      /* Header */
      .edit-header {
        background: var(--primary-bg);
        color: white;
        padding: 24px 32px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        box-shadow: var(--shadow-md);
      }

      .edit-header h2 {
        margin: 0;
        font-size: 24px;
        font-weight: 600;
        letter-spacing: -0.025em;
      }

      .price-display {
        display: flex;
        align-items: center;
        gap: 12px;
        background: rgba(255, 255, 255, 0.3);
        padding: 12px 20px;
        border-radius: 12px;
        backdrop-filter: blur(10px);
      }

      .price-label {
        font-size: 14px;
        opacity: 0.9;
      }

      .price-amount {
        font-size: 20px;
        font-weight: 700;
        color: #fbbf24;
      }

      /* Layout */
      .edit-layout {
        display: grid;
        grid-template-columns: 75% 1fr;
        gap: 0;
        min-height: calc(100vh - 88px);
        transition: grid-template-columns 0.3s ease;
      }

      .edit-layout.collapsed {
        grid-template-columns: 60px 1fr;
      }

      /* Options Panel (Left) */
      .options-panel {
        background: var(--secondary-bg);
        padding: 32px;
        border-right: 1px solid var(--border-color);
        overflow-y: auto;
        position: relative;
        transition: all 0.3s ease;
      }

      .options-panel-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 24px;
      }

      .panel-title {
        font-size: 20px;
        font-weight: 600;
        margin: 0;
        color: var(--text-primary);
        padding-bottom: 12px;
        border-bottom: 2px solid var(--accent-blue);
      }

      .options-section {
        background: white;
        border-radius: 12px;
        padding: 20px;
        margin-bottom: 24px;
        box-shadow: var(--shadow-sm);
        border: 1px solid var(--border-color);
      }

      .options-section h4 {
        font-size: 16px;
        font-weight: 600;
        margin: 0 0 16px 0;
        color: var(--text-primary);
      }

      /* Configuration Panel (Right) */
      .configuration-panel {
        background: white;
        padding: 32px;
        overflow-y: auto;
      }

      .toggle-button {
        background: var(--accent-blue);
        color: white;
        border: none;
        border-radius: 8px;
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.2s ease;
        flex-shrink: 0;
      }

      .toggle-button:hover {
        background: #2563eb;
        transform: scale(1.05);
      }

      .toggle-button.collapsed {
        transform: rotate(180deg);
      }

      .toggle-icon {
        width: 16px;
        height: 16px;
        transition: transform 0.2s ease;
      }

      .toggle-button.collapsed .toggle-icon {
        animation: slow-rotate 6s linear infinite;
      }

      .config-section {
        background: var(--secondary-bg);
        border-radius: 12px;
        padding: 24px;
        margin-bottom: 24px;
        border: 1px solid var(--border-color);
      }

      .config-section h4 {
        font-size: 18px;
        font-weight: 600;
        margin: 0 0 20px 0;
        color: var(--text-primary);
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .config-field {
        margin-bottom: 20px;
      }

      .config-field:last-child {
        margin-bottom: 0;
      }

      .field-label {
        display: block;
        font-size: 14px;
        font-weight: 500;
        color: var(--text-secondary);
        margin-bottom: 8px;
      }

      /* Select Components */
      .config-select {
        width: 100%;
      }

      .select-option {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 3px 0;
      }

      .select-option span {
        color: var(--text-secondary);
      }

      .color-swatch-small {
        width: 20px;
        height: 20px;
        border-radius: 50%;
        border: 2px solid var(--border-color);
        flex-shrink: 0;
      }

      .price {
        margin-left: auto;
        font-size: 12px;
        color: var(--accent-green);
        font-weight: 500;
      }

      /* Form Fields */
      .config-field .boxel-field {
        margin-bottom: 0;
      }

      .config-field .boxel-field__label {
        font-size: 14px;
        font-weight: 500;
        color: var(--text-secondary);
        margin-bottom: 8px;
      }

      .config-field .boxel-field__input {
        border: 1px solid var(--border-color);
        border-radius: 8px;
        padding: 12px;
        font-size: 14px;
        transition: all 0.2s ease;
      }

      .config-field .boxel-field__input:focus {
        outline: none;
        border-color: var(--accent-blue);
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
      }

      /* Checkbox Styling */
      .config-field .boxel-checkbox {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px;
        background: white;
        border: 1px solid var(--border-color);
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .config-field .boxel-checkbox:hover {
        border-color: var(--accent-blue);
        background: var(--hover-bg);
      }

      .config-field .boxel-checkbox input[type='checkbox'] {
        width: 18px;
        height: 18px;
        accent-color: var(--accent-blue);
      }

      /* Collapsed State */
      .edit-layout.collapsed .options-panel {
        padding: 16px 8px;
      }

      .edit-layout.collapsed .options-panel-header {
        margin-bottom: 0;
      }

      .edit-layout.collapsed .options-panel .panel-title {
        display: none;
      }

      .edit-layout.collapsed .options-section {
        display: none;
      }

      /* Responsive Design */
      @media (max-width: 1024px) {
        .edit-layout {
          grid-template-columns: 1fr;
        }

        .edit-layout.collapsed {
          grid-template-columns: 1fr;
        }

        .options-panel {
          border-right: none;
          border-bottom: 1px solid var(--border-color);
        }

        .configuration-panel {
          border-top: 1px solid var(--border-color);
        }

        .edit-header {
          flex-direction: column;
          gap: 16px;
          text-align: center;
        }
      }

      @media (max-width: 768px) {
        .edit-header,
        .options-panel,
        .configuration-panel {
          padding: 20px;
        }

        .edit-header h2 {
          font-size: 20px;
        }

        .price-amount {
          font-size: 18px;
        }
      }
    </style>
  </template>
}

export class CarConfiguratorEV extends CardDef {
  static displayName = 'EV Car Configurator';
  static icon = CarIcon;
  static prefersWideFormat = true;

  @field modelName = contains(StringField);
  @field basePrice = contains(NumberField);
  @field selectedColor = contains(ConfigOptionField);
  @field selectedTrim = contains(ConfigOptionField);
  @field selectedRange = contains(ConfigOptionField);
  @field selectedWheels = contains(ConfigOptionField);
  @field selectedInterior = contains(ConfigOptionField);
  @field autopilotEnabled = contains(BooleanField);
  @field premiumAudioEnabled = contains(BooleanField);
  @field sunroofEnabled = contains(BooleanField);

  // Configuration options
  @field colorOptions = containsMany(ConfigOptionField);
  @field trimOptions = containsMany(ConfigOptionField);
  @field rangeOptions = containsMany(ConfigOptionField);
  @field wheelOptions = containsMany(ConfigOptionField);
  @field interiorOptions = containsMany(ConfigOptionField);

  @field totalPrice = contains(NumberField, {
    computeVia: function (this: CarConfiguratorEV) {
      let total = this.basePrice || 0;

      // Add selected options prices
      if (this.selectedColor) total += this.selectedColor.price || 0;
      if (this.selectedTrim) total += this.selectedTrim.price || 0;
      if (this.selectedRange) total += this.selectedRange.price || 0;
      if (this.selectedWheels) total += this.selectedWheels.price || 0;
      if (this.selectedInterior) total += this.selectedInterior.price || 0;

      // Add premium features
      if (this.autopilotEnabled) total += 8000;
      if (this.premiumAudioEnabled) total += 2500;
      if (this.sunroofEnabled) total += 1500;

      return total;
    },
  });

  static isolated = CarConfiguratorEVIsolated;

  static edit = CardConfiguratorEvEdit;
}
