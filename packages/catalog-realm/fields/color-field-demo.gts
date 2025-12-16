// ═══ [EDIT TRACKING: ON] Mark all changes with ⁿ ═══
import {
  // ¹ Core imports
  CardDef,
  field,
  contains,
  Component,
} from 'https://cardstack.com/base/card-api';
import ColorField from './color-field'; // ² ColorField import
import PaletteIcon from '@cardstack/boxel-icons/palette'; // ³ Icon import

export class ColorFieldDemo extends CardDef {
  // ⁴ Demo card definition
  static displayName = 'ColorField Demo';
  static icon = PaletteIcon;
  static prefersWideFormat = true;

  // ⁵ Standard variant - default color picker with addons
  @field standardColor = contains(ColorField, {
    configuration: {
      variant: 'standard',
      options: {
        showRecent: true,
        showContrastChecker: true,
      },
    },
  });

  // ⁶ Swatches variant - preset palette for quick selection
  @field swatchesColor = contains(ColorField, {
    configuration: {
      variant: 'swatches-picker',
      options: {
        paletteColors: [
          '#ef4444', // red
          '#f97316', // orange
          '#facc15', // yellow
          '#22c55e', // green
          '#3b82f6', // blue
          '#6366f1', // indigo
          '#a855f7', // purple
          '#ec4899', // pink
        ],
      },
    },
  });

  // ⁷ Slider variant - RGB only
  @field sliderRgbColor = contains(ColorField, {
    configuration: {
      variant: 'slider',
      options: {
        defaultFormat: 'rgb',
      },
    },
  });

  // ⁸ Slider variant - HSL only
  @field sliderHslColor = contains(ColorField, {
    configuration: {
      variant: 'slider',
      options: {
        defaultFormat: 'hsl',
        allowedFormats: ['rgb', 'hsl'],
      },
    },
  });

  // ⁹ Slider variant - All formats with selector
  @field sliderAllColor = contains(ColorField, {
    configuration: {
      variant: 'slider',
      options: {
        defaultFormat: 'rgb',
        allowedFormats: ['rgb', 'hsl', 'hsb'],
        showFormatSelector: false,
      },
    },
  });

  // ¹⁰ Wheel variant - color wheel with format selector
  @field wheelColor = contains(ColorField, {
    configuration: {
      variant: 'wheel',
      options: {
        defaultFormat: 'rgb',
        allowedFormats: ['hex', 'rgb', 'hsl'],
        showFormatSelector: true,
      },
    },
  });

  // ¹¹ Advanced variant - full featured with all formats
  @field advancedColor = contains(ColorField, {
    configuration: {
      variant: 'advanced',
      options: {
        defaultFormat: 'hex',
        allowedFormats: ['hex', 'rgb', 'hsl', 'hsb', 'css'],
        showFormatSelector: true,
      },
    },
  });

  // ¹² Advanced variant - locked format (no selector)
  @field advancedLockedColor = contains(ColorField, {
    configuration: {
      variant: 'advanced',
      options: {
        defaultFormat: 'hex',
        allowedFormats: ['hex', 'rgb'],
        showFormatSelector: false, // Hide dropdown, lock to hex
      },
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    // ¹³ Isolated format
    <template>
      <div class='color-demo-container'>
        <header class='demo-header'>
          <h1>ColorField Variants Demo</h1>
          <p class='demo-description'>
            Explore all ColorField variants and their configuration options
          </p>
        </header>

        <div class='variants-grid'>
          {{! ¹⁴ Standard variant }}
          <section class='variant-card'>
            <div class='variant-header'>
              <h2>Standard</h2>
              <p>Default color picker with recent colors and contrast checker</p>
            </div>
            <div class='config-code'>
              <pre><code>@field color = contains(ColorField, &#123;
                  configuration: &#123; variant: 'standard', options: &#123;
                  showRecent: true, showContrastChecker: true &#125; &#125;
                  &#125;);</code></pre>
            </div>
            <div class='variant-demo'>
              <@fields.standardColor @format='edit' />
            </div>
          </section>

          {{! ¹⁵ Swatches variant }}
          <section class='variant-card'>
            <div class='variant-header'>
              <h2>Swatches Picker</h2>
              <p>Preset palette for quick color selection</p>
            </div>
            <div class='config-code'>
              <pre><code>@field color = contains(ColorField, &#123;
                  configuration: &#123; variant: 'swatches-picker', options:
                  &#123; paletteColors: ['#ef4444', '#f97316', ...] &#125;
                  &#125; &#125;);</code></pre>
            </div>
            <div class='variant-demo'>
              <@fields.swatchesColor @format='edit' />
            </div>
          </section>

          {{! ¹⁶ Slider RGB variant }}
          <section class='variant-card'>
            <div class='variant-header'>
              <h2>Slider (RGB Only)</h2>
              <p>RGB sliders locked to RGB format</p>
            </div>
            <div class='config-code'>
              <pre><code>@field color = contains(ColorField, &#123;
                  configuration: &#123; variant: 'slider', options: &#123;
                  allowedFormats: ['rgb'] &#125; &#125; &#125;);</code></pre>
            </div>
            <div class='variant-demo'>
              <@fields.sliderRgbColor @format='edit' />
            </div>
          </section>

          {{! ¹⁷ Slider HSL variant }}
          <section class='variant-card'>
            <div class='variant-header'>
              <h2>Slider (HSL Only)</h2>
              <p>HSL sliders locked to HSL format</p>
            </div>
            <div class='config-code'>
              <pre><code>@field color = contains(ColorField, &#123;
                  configuration: &#123; variant: 'slider', options: &#123;
                  allowedFormats: ['hsl'] &#125; &#125; &#125;);</code></pre>
            </div>
            <div class='variant-demo'>
              <@fields.sliderHslColor @format='edit' />
            </div>
          </section>

          {{! ¹⁸ Slider All variant }}
          <section class='variant-card'>
            <div class='variant-header'>
              <h2>Slider (Format Selector)</h2>
              <p>Switch between RGB, HSL, and HSB with dropdown</p>
            </div>
            <div class='config-code'>
              <pre><code>@field color = contains(ColorField, &#123;
                  configuration: &#123; variant: 'slider', options: &#123;
                  allowedFormats: ['rgb', 'hsl', 'hsb'], showFormatSelector:
                  true &#125; &#125; &#125;);</code></pre>
            </div>
            <div class='variant-demo'>
              <@fields.sliderAllColor @format='edit' />
            </div>
          </section>

          {{! ¹⁹ Wheel variant }}
          <section class='variant-card'>
            <div class='variant-header'>
              <h2>Wheel</h2>
              <p>Color wheel with format selector dropdown</p>
            </div>
            <div class='config-code'>
              <pre><code>@field color = contains(ColorField, &#123;
                  configuration: &#123; variant: 'wheel', options: &#123;
                  defaultFormat: 'hex', allowedFormats: ['hex', 'rgb', 'hsl'],
                  showFormatSelector: true &#125; &#125; &#125;);</code></pre>
            </div>
            <div class='variant-demo'>
              <@fields.wheelColor @format='edit' />
            </div>
          </section>

          {{! ²⁰ Advanced variant }}
          <section class='variant-card'>
            <div class='variant-header'>
              <h2>Advanced (All Formats)</h2>
              <p>Full-featured picker with all format options</p>
            </div>
            <div class='config-code'>
              <pre><code>@field color = contains(ColorField, &#123;
                  configuration: &#123; variant: 'advanced', options: &#123;
                  defaultFormat: 'hex', allowedFormats: ['hex', 'rgb', 'hsl',
                  'hsb', 'css'], showFormatSelector: true &#125; &#125; &#125;);</code></pre>
            </div>
            <div class='variant-demo'>
              <@fields.advancedColor @format='edit' />
            </div>
          </section>

          {{! ²⁰ Advanced locked variant }}
          <section class='variant-card'>
            <div class='variant-header'>
              <h2>Advanced (Locked Format)</h2>
              <p>Hex-only picker without format selector</p>
            </div>
            <div class='config-code'>
              <pre><code>@field color = contains(ColorField, &#123;
                  configuration: &#123; variant: 'advanced', options: &#123;
                  defaultFormat: 'hex', allowedFormats: ['hex', 'rgb'],
                  showFormatSelector: false &#125; &#125; &#125;);</code></pre>
            </div>
            <div class='variant-demo'>
              <@fields.advancedLockedColor @format='edit' />
            </div>
          </section>
        </div>
      </div>

      <style scoped>
        /* ²¹ Component styles */
        .color-demo-container {
          padding: 2rem;
          max-width: 1400px;
          margin: 0 auto;
        }

        .demo-header {
          text-align: center;
          margin-bottom: 3rem;
        }

        .demo-header h1 {
          font-size: 2rem;
          font-weight: 700;
          color: var(--foreground, #0f172a);
          margin: 0 0 0.5rem;
        }

        .demo-description {
          font-size: 1rem;
          color: var(--muted-foreground, #64748b);
          margin: 0;
        }

        .variants-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
          gap: 2rem;
        }

        .variant-card {
          background: var(--card, #ffffff);
          border: 1px solid var(--border, #e2e8f0);
          border-radius: var(--radius, 0.5rem);
          padding: 1.5rem;
          display: flex;
          flex-direction: column;
          gap: 1rem;
          transition: all 0.2s ease;
        }

        .variant-card:hover {
          border-color: var(--ring, #3b82f6);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
        }

        .variant-header h2 {
          font-size: 1.25rem;
          font-weight: 600;
          color: var(--foreground, #0f172a);
          margin: 0 0 0.5rem;
        }

        .variant-header p {
          font-size: 0.875rem;
          color: var(--muted-foreground, #64748b);
          margin: 0;
          line-height: 1.5;
        }

        .config-code {
          background: var(--muted, #f8fafc);
          border: 1px solid var(--border, #e2e8f0);
          border-radius: var(--radius, 0.375rem);
          overflow: hidden;
        }

        .config-code pre {
          margin: 0;
          padding: 1rem;
          overflow-x: auto;
        }

        .config-code code {
          font-family: var(--font-mono, 'Courier New', monospace);
          font-size: 0.75rem;
          line-height: 1.6;
          color: var(--foreground, #1e293b);
          white-space: pre;
        }

        .variant-demo {
          min-height: 200px;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 1rem;
          background: var(--background, #ffffff);
          border: 1px dashed var(--border, #e2e8f0);
          border-radius: var(--radius, 0.375rem);
        }

        .variant-demo > :first-child {
          width: 100%;
        }

        @media (max-width: 768px) {
          .color-demo-container {
            padding: 1rem;
          }

          .variants-grid {
            grid-template-columns: 1fr;
            gap: 1.5rem;
          }

          .demo-header h1 {
            font-size: 1.5rem;
          }
        }
      </style>
    </template>
  };
}
