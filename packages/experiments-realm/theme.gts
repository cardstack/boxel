import { concat, fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { htmlSafe } from '@ember/template';
import { tracked } from '@glimmer/tracking';

import {
  CardDef,
  Component,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import ColorField from 'https://cardstack.com/base/color';
import TextAreaField from 'https://cardstack.com/base/text-area';
import UrlField from 'https://cardstack.com/base/url';

import { eq } from '@cardstack/boxel-ui/helpers';

import { sanitizeHtml } from '@cardstack/runtime-common';

// Helper function to safely apply CSS from user input
export function sanitize(css?: string) {
  if (!css) {
    return;
  }
  return htmlSafe(sanitizeHtml(css));
}

class Isolated extends Component<typeof BrandTheme> {
  @tracked copiedValue?: string | null = null;

  @action
  copyToClipboard(text?: string | null) {
    try {
      if (!text) {
        return;
      }
      navigator.clipboard.writeText(text);
      this.copiedValue = text;
      setTimeout(() => {
        this.copiedValue = null;
      }, 1500);
    } catch (err) {
      console.error('Failed to copy: ', err);
    }
  }

  <template>
    <div class='style-guide-card' style={{sanitize @model.cssVariables}}>
      <header class='brand-header'>
        <div class='brand-logo-container'>
          <img src={{@model.logoURL}} alt={{@model.brand}} class='brand-logo' />
        </div>
        <div class='brand-identity'>
          <img
            src={{@model.symbolURL}}
            alt={{@model.brand}}
            class='brand-symbol'
          />
          <h1 class='brand-name'>{{@model.brand}} Theme</h1>
        </div>
        <p class='brand-description'>{{if
            @model.description
            @model.description
            'A comprehensive guide to brand elements and visual style'
          }}</p>
      </header>

      <div class='color-palette-section'>
        <h2 class='section-title'>Color Palette</h2>
        <div class='color-palette'>
          <div class='color-swatch primary-swatch'>
            <div
              class='color-display'
              style={{sanitize
                (concat 'background-color:' @model.colorPrimary)
              }}
            >
              <button
                class='color-copy'
                title='Copy color value'
                {{on 'click' (fn this.copyToClipboard @model.colorPrimary)}}
              >
                {{#if (eq this.copiedValue @model.colorPrimary)}}
                  <span class='copied-indicator'>✓</span>
                {{else}}
                  <span class='copy-icon'>+</span>
                {{/if}}
              </button>
            </div>
            <div class='color-details'>
              <span class='color-label'>Primary</span>
              <span class='color-value'>{{@model.colorPrimary}}</span>
            </div>
          </div>

          <div class='color-swatch secondary-swatch'>
            <div
              class='color-display'
              style={{sanitize
                (concat 'background-color:' @model.colorSecondary)
              }}
            >
              <button
                class='color-copy'
                title='Copy color value'
                {{on 'click' (fn this.copyToClipboard @model.colorSecondary)}}
              >
                {{#if (eq this.copiedValue @model.colorSecondary)}}
                  <span class='copied-indicator'>✓</span>
                {{else}}
                  <span class='copy-icon'>+</span>
                {{/if}}
              </button>
            </div>
            <div class='color-details'>
              <span class='color-label'>Secondary</span>
              <span class='color-value'>{{@model.colorSecondary}}</span>
            </div>
          </div>

          <div class='color-swatch dark-swatch'>
            <div
              class='color-display'
              style={{sanitize (concat 'background-color:' @model.colorDark)}}
            >
              <button
                class='color-copy'
                title='Copy color value'
                {{on 'click' (fn this.copyToClipboard @model.colorDark)}}
              >
                {{#if (eq this.copiedValue @model.colorDark)}}
                  <span class='copied-indicator'>✓</span>
                {{else}}
                  <span class='copy-icon'>+</span>
                {{/if}}
              </button>
            </div>
            <div class='color-details'>
              <span class='color-label'>Dark</span>
              <span class='color-value'>{{@model.colorDark}}</span>
            </div>
          </div>

          <div class='color-swatch light-swatch'>
            <div
              class='color-display'
              style={{sanitize (concat 'background-color:' @model.colorLight)}}
            >
              <button
                class='color-copy'
                title='Copy color value'
                {{on 'click' (fn this.copyToClipboard @model.colorLight)}}
              >
                {{#if (eq this.copiedValue @model.colorLight)}}
                  <span class='copied-indicator'>✓</span>
                {{else}}
                  <span class='copy-icon'>+</span>
                {{/if}}
              </button>
            </div>
            <div class='color-details'>
              <span class='color-label'>Light</span>
              <span class='color-value'>{{@model.colorLight}}</span>
            </div>
          </div>

          <div class='color-swatch bg-swatch'>
            <div
              class='color-display'
              style={{sanitize
                (concat 'background-color:' @model.colorBackground)
              }}
            >
              <button
                class='color-copy'
                title='Copy color value'
                {{on 'click' (fn this.copyToClipboard @model.colorBackground)}}
              >
                {{#if (eq this.copiedValue @model.colorBackground)}}
                  <span class='copied-indicator'>✓</span>
                {{else}}
                  <span class='copy-icon'>+</span>
                {{/if}}
              </button>
            </div>
            <div class='color-details'>
              <span class='color-label'>Background</span>
              <span class='color-value'>{{@model.colorBackground}}</span>
            </div>
          </div>
        </div>
      </div>

      <div class='typography-section'>
        <h2 class='section-title'>Typography</h2>
        <div class='font-details'>
          <div class='font-family'>
            <span class='font-label'>Font Family</span>
            <div class='font-value-container'>
              <span class='font-value'>{{@model.fontFamily}}</span>
              <button
                class='text-copy'
                title='Copy font family'
                {{on 'click' (fn this.copyToClipboard @model.fontFamily)}}
              >
                {{#if (eq this.copiedValue @model.fontFamily)}}✓{{else}}+{{/if}}
              </button>
            </div>
          </div>
          <div class='font-sizes'>
            <div class='font-size-sample heading-size'>
              <span class='font-size-label'>Heading</span>
              <div
                class='font-size-display'
                style={{sanitize
                  (concat
                    'font-size:'
                    @model.headerFontSize
                    ';line-height:'
                    @model.lineHeight
                  )
                }}
              >The quick brown fox</div>
              <div class='font-size-value-container'>
                <span class='font-size-value'>{{@model.headerFontSize}}</span>
                <button
                  class='text-copy'
                  title='Copy header size'
                  {{on 'click' (fn this.copyToClipboard @model.headerFontSize)}}
                >
                  {{#if
                    (eq this.copiedValue @model.headerFontSize)
                  }}✓{{else}}+{{/if}}
                </button>
              </div>
            </div>
            <div class='font-size-sample body-size'>
              <span class='font-size-label'>Body</span>
              <div
                class='font-size-display'
                style={{sanitize
                  (concat
                    'font-size:'
                    @model.bodyFontSize
                    ';line-height:'
                    @model.lineHeight
                  )
                }}
              >The quick brown fox</div>
              <div class='font-size-value-container'>
                <span class='font-size-value'>{{@model.bodyFontSize}}</span>
                <button
                  class='text-copy'
                  title='Copy body size'
                  {{on 'click' (fn this.copyToClipboard @model.bodyFontSize)}}
                >
                  {{#if
                    (eq this.copiedValue @model.bodyFontSize)
                  }}✓{{else}}+{{/if}}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class='ui-components-section'>
        <h2 class='section-title'>UI Components</h2>
        <div class='components-showcase'>
          <div class='component-group'>
            <span class='component-label'>Buttons</span>
            <div class='button-samples'>
              <button class='primary-button'>Primary Button</button>
              <button class='secondary-button'>Secondary Button</button>
            </div>
          </div>

          <div class='component-group'>
            <span class='component-label'>Brand Radius</span>
            <div class='radius-sample'>
              <div
                class='radius-display'
                style={{sanitize (concat 'border-radius:' @model.borderRadius)}}
              ></div>
              <div class='radius-value'>{{@model.borderRadius}}</div>
            </div>
          </div>
        </div>
      </div>

      <div class='brand-assets-section'>
        <h2 class='section-title'>Brand Assets</h2>
        <div class='asset-samples'>
          <div class='asset-item'>
            <span class='asset-label'>Logo</span>
            <div class='asset-display'>
              <img src={{@model.logoURL}} alt={{@model.brand}} />
            </div>
          </div>

          <div class='asset-item'>
            <span class='asset-label'>Symbol</span>
            <div class='asset-display symbol-display'>
              <img src={{@model.symbolURL}} alt='{{@model.brand}} Symbol' />
            </div>
          </div>
        </div>
      </div>
    </div>

    <style scoped>
      .style-guide-card {
        font-family: var(--font-family-base, sans-serif);
        color: var(--color-dark, #333);
        line-height: var(--lineheight-base, 1.6);
        background: white;
        border-radius: 12px;
        box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08);
        width: 100%;
        padding: 0;
      }

      .brand-header {
        padding: 30px;
        background-color: var(--color-background, #f9f9f9);
        border-bottom: 1px solid #eee;
        text-align: center;
      }

      .brand-logo-container {
        height: 60px;
        display: flex;
        align-items: center;
        justify-content: center;
        margin-bottom: 24px;
      }

      .brand-logo {
        max-height: 100%;
        max-width: 180px;
        object-fit: contain;
      }

      .brand-identity {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 12px;
        margin-bottom: 16px;
      }

      .brand-symbol {
        width: 32px;
        height: 32px;
        object-fit: contain;
      }

      .brand-name {
        font-size: 24px;
        font-weight: 600;
        margin: 0;
        color: var(--color-primary, #333);
      }

      .brand-description {
        max-width: 600px;
        margin: 0 auto;
        font-size: 16px;
        color: var(--color-dark, #555);
        line-height: 1.5;
      }

      .section-title {
        font-size: 18px;
        font-weight: 600;
        margin: 0 0 20px 0;
        color: var(--color-primary, #333);
      }

      .color-palette-section,
      .typography-section,
      .ui-components-section,
      .brand-assets-section {
        padding: 30px;
        border-bottom: 1px solid #eee;
      }

      .color-palette {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
        gap: 20px;
      }

      .color-swatch {
        display: flex;
        flex-direction: column;
      }

      .color-display {
        position: relative;
        height: 80px;
        border: 1px solid rgba(0, 0, 0, 0.1);
        border-radius: 8px;
        margin-bottom: 8px;
        transition: transform 0.2s ease;
      }

      .color-display:hover {
        transform: scale(1.02);
      }

      .color-copy {
        position: absolute;
        top: 8px;
        right: 8px;
        width: 24px;
        height: 24px;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.9);
        border: none;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        opacity: 0;
        transition: opacity 0.2s ease;
      }

      .color-display:hover .color-copy {
        opacity: 1;
      }

      .copy-icon,
      .copied-indicator {
        font-size: 14px;
        line-height: 1;
        color: #333;
      }

      .copied-indicator {
        color: #22c55e;
      }

      .color-details {
        display: flex;
        flex-direction: column;
      }

      .color-label {
        font-size: 15px;
        font-weight: 600;
        margin-bottom: 2px;
      }

      .color-value {
        font-family: monospace;
        font-size: 13px;
        color: #666;
      }

      .font-details {
        display: flex;
        flex-direction: column;
        gap: 30px;
      }

      .font-family {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .font-label,
      .font-size-label {
        font-size: 15px;
        font-weight: 600;
      }

      .font-value-container,
      .font-size-value-container {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .font-value,
      .font-size-value {
        font-family: monospace;
        font-size: 13px;
        color: #666;
        background: var(--boxel-150);
        padding: 8px 12px;
        border-radius: 4px;
        flex: 1;
        white-space: nowrap;
        text-overflow: ellipsis;
      }

      .text-copy {
        width: 24px;
        height: 24px;
        border-radius: 4px;
        background: #f0f0f0;
        border: none;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        font-size: 14px;
        color: #666;
        transition: background 0.2s ease;
      }

      .text-copy:hover {
        background: #e5e5e5;
      }

      .font-sizes {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
        gap: 20px;
      }

      .font-size-sample {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .font-size-display {
        background: #f9f9f9;
        height: 80px;
        border-radius: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0 16px;
        text-align: center;
      }

      .heading-size .font-size-display {
        font-weight: bold;
      }

      .components-showcase {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
        gap: 30px;
      }

      .component-group {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }

      .component-label {
        font-size: 15px;
        font-weight: 600;
      }

      .button-samples {
        display: flex;
        gap: 12px;
      }

      .primary-button {
        background-color: var(--color-primary, #0058a3);
        color: var(--color-light, #ffffff);
        border: none;
        padding: 10px 20px;
        font-family: var(--font-family-base, sans-serif);
        font-size: 14px;
        border-radius: var(--radius-base, 0px);
        cursor: pointer;
      }

      .secondary-button {
        background-color: var(--color-secondary, #ffd500);
        color: var(--color-dark, #003b6f);
        border: none;
        padding: 10px 20px;
        font-family: var(--font-family-base, sans-serif);
        font-size: 14px;
        border-radius: var(--radius-base, 0px);
        cursor: pointer;
      }

      .radius-sample {
        display: flex;
        flex-direction: column;
        gap: 12px;
        align-items: center;
      }

      .radius-display {
        width: 100px;
        height: 100px;
        background: var(--color-primary, #0058a3);
      }

      .radius-value {
        font-family: monospace;
        font-size: 13px;
      }

      .asset-samples {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
        gap: 30px;
      }

      .asset-item {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .asset-label {
        font-size: 15px;
        font-weight: 600;
      }

      .asset-display {
        background-color: var(--color-light, white);
        border: 1px solid #eee;
        border-radius: 8px;
        padding: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 120px;
      }

      .asset-display img {
        max-width: 100%;
        max-height: 80px;
        object-fit: contain;
      }

      .symbol-display img {
        max-height: 60px;
        max-width: 60px;
      }
    </style>
  </template>
}

class Embedded extends Component<typeof BrandTheme> {
  @tracked copiedValue: string | null = null;

  @action
  copyToClipboard(text?: string | null) {
    try {
      if (!text) {
        return;
      }
      navigator.clipboard.writeText(text);
      this.copiedValue = text;
      setTimeout(() => {
        this.copiedValue = null;
      }, 1500);
    } catch (err) {
      console.error('Failed to copy: ', err);
    }
  }

  <template>
    <div class='style-guide-card' style={{sanitize @model.cssVariables}}>
      <header class='brand-header'>
        <div class='brand-logo-container'>
          <img src={{@model.logoURL}} alt={{@model.brand}} class='brand-logo' />
        </div>
        <div class='brand-identity'>
          <img
            src={{@model.symbolURL}}
            alt={{@model.brand}}
            class='brand-symbol'
          />
          <h2 class='brand-name'>{{@model.brand}}</h2>
        </div>
      </header>

      <div class='color-palette-section'>
        <h3 class='section-title'>Color Palette</h3>
        <div class='color-palette'>
          <div class='color-swatch primary-swatch'>
            <div
              class='color-display'
              style={{sanitize
                (concat 'background-color:' @model.colorPrimary)
              }}
            >
              <button
                class='color-copy'
                title='Copy color value'
                {{on 'click' (fn this.copyToClipboard @model.colorPrimary)}}
              >
                {{#if (eq this.copiedValue @model.colorPrimary)}}
                  <span class='copied-indicator'>✓</span>
                {{else}}
                  <span class='copy-icon'>+</span>
                {{/if}}
              </button>
            </div>
            <div class='color-details'>
              <span class='color-label'>Primary</span>
              <span class='color-value'>{{@model.colorPrimary}}</span>
            </div>
          </div>

          <div class='color-swatch secondary-swatch'>
            <div
              class='color-display'
              style={{sanitize
                (concat 'background-color:' @model.colorSecondary)
              }}
            >
              <button
                class='color-copy'
                title='Copy color value'
                {{on 'click' (fn this.copyToClipboard @model.colorSecondary)}}
              >
                {{#if (eq this.copiedValue @model.colorSecondary)}}
                  <span class='copied-indicator'>✓</span>
                {{else}}
                  <span class='copy-icon'>+</span>
                {{/if}}
              </button>
            </div>
            <div class='color-details'>
              <span class='color-label'>Secondary</span>
              <span class='color-value'>{{@model.colorSecondary}}</span>
            </div>
          </div>

          <div class='color-swatch dark-swatch'>
            <div
              class='color-display'
              style={{sanitize (concat 'background-color:' @model.colorDark)}}
            >
              <button
                class='color-copy'
                title='Copy color value'
                {{on 'click' (fn this.copyToClipboard @model.colorDark)}}
              >
                {{#if (eq this.copiedValue @model.colorDark)}}
                  <span class='copied-indicator'>✓</span>
                {{else}}
                  <span class='copy-icon'>+</span>
                {{/if}}
              </button>
            </div>
            <div class='color-details'>
              <span class='color-label'>Dark</span>
              <span class='color-value'>{{@model.colorDark}}</span>
            </div>
          </div>

          <div class='color-swatch light-swatch'>
            <div
              class='color-display'
              style={{sanitize (concat 'background-color:' @model.colorLight)}}
            >
              <button
                class='color-copy'
                title='Copy color value'
                {{on 'click' (fn this.copyToClipboard @model.colorLight)}}
              >
                {{#if (eq this.copiedValue @model.colorLight)}}
                  <span class='copied-indicator'>✓</span>
                {{else}}
                  <span class='copy-icon'>+</span>
                {{/if}}
              </button>
            </div>
            <div class='color-details'>
              <span class='color-label'>Light</span>
              <span class='color-value'>{{@model.colorLight}}</span>
            </div>
          </div>

          <div class='color-swatch bg-swatch'>
            <div
              class='color-display'
              style={{sanitize
                (concat 'background-color:' @model.colorBackground)
              }}
            >
              <button
                class='color-copy'
                title='Copy color value'
                {{on 'click' (fn this.copyToClipboard @model.colorBackground)}}
              >
                {{#if (eq this.copiedValue @model.colorBackground)}}
                  <span class='copied-indicator'>✓</span>
                {{else}}
                  <span class='copy-icon'>+</span>
                {{/if}}
              </button>
            </div>
            <div class='color-details'>
              <span class='color-label'>Background</span>
              <span class='color-value'>{{@model.colorBackground}}</span>
            </div>
          </div>
        </div>
      </div>

      <div class='typography-section'>
        <h3 class='section-title'>Typography</h3>
        <div class='font-details'>
          <div class='font-family'>
            <span class='font-label'>Font</span>
            <div class='font-value-container'>
              <span class='font-value'>{{@model.fontFamily}}</span>
              <button
                class='text-copy'
                title='Copy font family'
                {{on 'click' (fn this.copyToClipboard @model.fontFamily)}}
              >
                {{#if (eq this.copiedValue @model.fontFamily)}}✓{{else}}+{{/if}}
              </button>
            </div>
          </div>
          <div class='font-sizes'>
            <div class='font-size-sample heading-size'>
              <span class='font-size-label'>H1</span>
              <span
                class='font-size-display'
                style={{sanitize
                  (concat
                    'font-size:'
                    @model.headerFontSize
                    ';line-height:'
                    @model.lineHeight
                  )
                }}
              >Aa</span>
              <div class='font-size-value-container'>
                <span class='font-size-value'>{{@model.headerFontSize}}</span>
                <button
                  class='text-copy'
                  title='Copy header size'
                  {{on 'click' (fn this.copyToClipboard @model.headerFontSize)}}
                >
                  {{#if
                    (eq this.copiedValue @model.headerFontSize)
                  }}✓{{else}}+{{/if}}
                </button>
              </div>
            </div>
            <div class='font-size-sample body-size'>
              <span class='font-size-label'>Body</span>
              <span
                class='font-size-display'
                style={{sanitize
                  (concat
                    'font-size:'
                    @model.bodyFontSize
                    ';line-height:'
                    @model.lineHeight
                  )
                }}
              >Aa</span>
              <div class='font-size-value-container'>
                <span class='font-size-value'>{{@model.bodyFontSize}}</span>
                <button
                  class='text-copy'
                  title='Copy body size'
                  {{on 'click' (fn this.copyToClipboard @model.bodyFontSize)}}
                >
                  {{#if
                    (eq this.copiedValue @model.bodyFontSize)
                  }}✓{{else}}+{{/if}}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <style scoped>
      .style-guide-card {
        font-family: var(--font-family-base, 'Inter', sans-serif);
        background: white;
        border-radius: 12px;
        box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08);
        overflow: hidden;
        width: 100%;
        color: #333;
      }

      .brand-header {
        padding: 24px;
        border-bottom: 1px solid #f0f0f0;
        background-color: #fafafa;
      }

      .brand-logo-container {
        height: 60px;
        display: flex;
        align-items: center;
        justify-content: center;
        margin-bottom: 16px;
        padding: 0 16px;
      }

      .brand-logo {
        max-height: 100%;
        max-width: 100%;
        object-fit: contain;
      }

      .brand-identity {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 12px;
      }

      .brand-symbol {
        width: 28px;
        height: 28px;
        object-fit: contain;
      }

      .brand-name {
        font-size: 18px;
        font-weight: 600;
        margin: 0;
      }

      .section-title {
        font-size: 14px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin: 0 0 16px 0;
        color: #666;
      }

      .color-palette-section {
        padding: 24px;
        border-bottom: 1px solid #f0f0f0;
      }

      .color-palette {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
        gap: 16px;
      }

      .color-swatch {
        display: flex;
        flex-direction: column;
      }

      .color-display {
        position: relative;
        height: 80px;
        border: 1px solid rgba(0, 0, 0, 0.1);
        border-radius: 8px;
        margin-bottom: 8px;
        transition: transform 0.2s ease;
      }

      .color-display:hover {
        transform: scale(1.02);
      }

      .color-copy {
        position: absolute;
        top: 8px;
        right: 8px;
        width: 24px;
        height: 24px;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.9);
        border: none;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        opacity: 0;
        transition: opacity 0.2s ease;
      }

      .color-display:hover .color-copy {
        opacity: 1;
      }

      .copy-icon,
      .copied-indicator {
        font-size: 14px;
        line-height: 1;
        color: #333;
      }

      .copied-indicator {
        color: #22c55e;
      }

      .color-details {
        display: flex;
        flex-direction: column;
      }

      .color-label {
        font-size: 13px;
        font-weight: 600;
        margin-bottom: 2px;
      }

      .color-value {
        font-family:
          'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
        font-size: 11px;
        color: #666;
      }

      .typography-section {
        padding: 24px;
      }

      .font-details {
        display: flex;
        flex-direction: column;
        gap: 20px;
      }

      .font-family {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .font-label,
      .font-size-label {
        font-size: 13px;
        font-weight: 600;
      }

      .font-value-container,
      .font-size-value-container {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .font-value,
      .font-size-value {
        font-family:
          'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
        font-size: 11px;
        color: #666;
        background: var(--boxel-150);
        padding: 4px 8px;
        border-radius: 4px;
        flex: 1;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .text-copy {
        width: 20px;
        height: 20px;
        border-radius: 4px;
        background: #f0f0f0;
        border: none;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        font-size: 12px;
        color: #666;
        transition: background 0.2s ease;
      }

      .text-copy:hover {
        background: #e5e5e5;
      }

      .font-sizes {
        display: flex;
        gap: 16px;
      }

      .font-size-sample {
        display: flex;
        flex-direction: column;
        gap: 8px;
        flex: 1;
      }

      .font-size-display {
        background: #f9f9f9;
        height: 60px;
        border-radius: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: var(--heading-font-weight, 600);
      }

      .heading-size .font-size-display {
        font-weight: bold;
      }
    </style>
  </template>
}

class Atom extends Component<typeof BrandTheme> {
  <template>
    <div class='theme-pill' style={{sanitize @model.cssVariables}}>
      <img
        src={{@model.symbolURL}}
        alt={{@model.brand}}
        class='theme-pill-logo'
      />
      <span class='theme-pill-name'>{{@model.brand}}</span>
    </div>

    <style scoped>
      .theme-pill {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        background-color: var(--color-background, #f5f5f5);
        border: 1px solid #e0e0e0;
        border-radius: 16px;
        padding: 4px 10px 4px 6px;
        font-family: var(--font-family-base, sans-serif);
      }

      .theme-pill-logo {
        width: 16px;
        height: 16px;
        object-fit: contain;
      }

      .theme-pill-name {
        font-size: 12px;
        color: var(--color-dark, #003b6f);
        white-space: nowrap;
      }
    </style>
  </template>
}

export class BrandTheme extends CardDef {
  static displayName = 'Brand Theme';

  @field brand = contains(StringField);
  @field logoURL = contains(UrlField);
  @field symbolURL = contains(UrlField);
  @field cssVariables = contains(TextAreaField);
  @field title = contains(StringField);
  @field description = contains(StringField);
  @field thumbnailURL = contains(UrlField, {
    computeVia: function (this: BrandTheme) {
      try {
        // Use the symbolURL as thumbnailURL
        return this.symbolURL || null;
      } catch (e) {
        return null;
      }
    },
  });

  // Extract colors and typography from cssVariables for display
  @field colorPrimary = contains(ColorField, {
    computeVia: function (this: BrandTheme) {
      try {
        const match = this.cssVariables?.match(
          /--color-primary: (#[0-9A-Fa-f]{3,6});/,
        );
        return match ? match[1] : '#000000';
      } catch (e) {
        return '#000000';
      }
    },
  });

  @field colorSecondary = contains(StringField, {
    computeVia: function (this: BrandTheme) {
      try {
        const match = this.cssVariables?.match(
          /--color-secondary: (#[0-9A-Fa-f]{3,6});/,
        );
        return match ? match[1] : '#000000';
      } catch (e) {
        return '#000000';
      }
    },
  });

  @field colorDark = contains(StringField, {
    computeVia: function (this: BrandTheme) {
      try {
        const match = this.cssVariables?.match(
          /--color-dark: (#[0-9A-Fa-f]{3,6});/,
        );
        return match ? match[1] : '#000000';
      } catch (e) {
        return '#000000';
      }
    },
  });

  @field colorLight = contains(StringField, {
    computeVia: function (this: BrandTheme) {
      try {
        const match = this.cssVariables?.match(
          /--color-light: (#[0-9A-Fa-f]{3,6});/,
        );
        return match ? match[1] : '#FFFFFF';
      } catch (e) {
        return '#FFFFFF';
      }
    },
  });

  @field colorBackground = contains(StringField, {
    computeVia: function (this: BrandTheme) {
      try {
        const match = this.cssVariables?.match(
          /--color-background: (#[0-9A-Fa-f]{3,6});/,
        );
        return match ? match[1] : '#F5F5F5';
      } catch (e) {
        return '#F5F5F5';
      }
    },
  });

  @field fontFamily = contains(StringField, {
    computeVia: function (this: BrandTheme) {
      try {
        const match = this.cssVariables?.match(
          /--font-family-base: ['"](.+)['"];/,
        );
        return match ? match[1] : 'sans-serif';
      } catch (e) {
        return 'sans-serif';
      }
    },
  });

  @field headerFontSize = contains(StringField, {
    computeVia: function (this: BrandTheme) {
      try {
        const match = this.cssVariables?.match(/--typescale-h1: ([0-9]+px);/);
        return match ? match[1] : '28px';
      } catch (e) {
        return '28px';
      }
    },
  });

  @field bodyFontSize = contains(StringField, {
    computeVia: function (this: BrandTheme) {
      try {
        const match = this.cssVariables?.match(/--typescale-body: ([0-9]+px);/);
        return match ? match[1] : '14px';
      } catch (e) {
        return '14px';
      }
    },
  });

  @field lineHeight = contains(StringField, {
    computeVia: function (this: BrandTheme) {
      try {
        const match = this.cssVariables?.match(
          /--lineheight-base: ([0-9\.]+);/,
        );
        return match ? match[1] : '1.6';
      } catch (e) {
        return '1.6';
      }
    },
  });

  @field borderRadius = contains(StringField, {
    computeVia: function (this: BrandTheme) {
      try {
        const match = this.cssVariables?.match(/--radius-base: ([0-9]+px);/);
        return match ? match[1] : '0px';
      } catch (e) {
        return '0px';
      }
    },
  });

  static isolated = Isolated;

  static embedded = Embedded;

  static atom = Atom;
}
