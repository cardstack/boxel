import {
  CardDef,
  field,
  contains,
  linksToMany,
  Component,
} from 'https://cardstack.com/base/card-api';
import GlimmerComponent from '@glimmer/component';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import MarkdownField from 'https://cardstack.com/base/markdown';
import ColorField from 'https://cardstack.com/base/color';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { fn, concat, array } from '@ember/helper';
import { on } from '@ember/modifier';
import { gt, currencyFormat } from '@cardstack/boxel-ui/helpers';
import DropletIcon from '@cardstack/boxel-icons/droplets';
import { htmlSafe } from '@ember/template';

interface SparkleFlavorBottleFlavor {
  flavorName?: string;
  primaryColor?: string;
  accentColor?: string;
  intensity?: number;
  price?: number;
}

interface SparkleFlavorBottleSignature {
  Args: {
    flavor: SparkleFlavorBottleFlavor;
    pauseAnimation?: boolean;
    onClick?: any;
  };
}

class SparkleFlavorBottle extends GlimmerComponent<SparkleFlavorBottleSignature> {
  get bottleStyle() {
    let primary = this.args.flavor?.primaryColor || '#3b82f6';
    let accent = this.args.flavor?.accentColor || '#1d4ed8';
    return htmlSafe(
      `--bottle-primary: ${primary}; --bottle-accent: ${accent};`,
    );
  }
  <template>
    <div
      class='flavor-bottle {{if @pauseAnimation "paused" ""}}'
      role='button'
      tabindex='0'
      {{on 'click' @onClick}}
      style={{this.bottleStyle}}
    >
      <div class='bottle-container'>
        <div class='bottle-shadow'></div>
        <div class='bottle-wrapper'>
          <div class='bottle-cap'>
            <div class='cap-top'></div>
            <div class='cap-rim'></div>
          </div>
          <div class='bottle-neck'>
            <div class='neck-ring'></div>
          </div>
          <div class='bottle-body'>
            <div class='bottle-highlight'></div>
            <div class='bottle-label-sticker'>
              <div class='label-content'>
                <div class='brand-name'>SPARKLE</div>
                <div class='flavor-text'>{{if
                    @flavor.flavorName
                    @flavor.flavorName
                    'MYSTERY'
                  }}</div>
                <div class='label-divider'></div>
                <div class='product-info'>
                  <span class='volume'>500ml</span>
                  <span class='calories'>0 cal</span>
                </div>
              </div>
            </div>
            <div class='bottle-content'>
              <div class='bubbles'>
                <div class='bubble bubble-1'></div>
                <div class='bubble bubble-2'></div>
                <div class='bubble bubble-3'></div>
                <div class='bubble bubble-4'></div>
                <div class='bubble bubble-5'></div>
                <div class='bubble bubble-6'></div>
                <div class='bubble bubble-7'></div>
                <div class='bubble bubble-8'></div>
              </div>
            </div>
          </div>
        </div>

        <div class='bottle-label'>
          <span class='flavor-name'>{{if
              @flavor.flavorName
              @flavor.flavorName
              'Mystery'
            }}</span>
          {{#if @flavor.price}}
            <span class='price'>&#36;{{@flavor.price}}</span>
          {{/if}}
        </div>
      </div>
    </div>

    <style scoped>
      .flavor-bottle {
        width: 100px;
        height: 140px;
        cursor: pointer;
        transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        outline: none;
      }

      .flavor-bottle:hover {
        transform: scale(1.15) translateY(-12px);
        filter: drop-shadow(0 20px 25px rgba(0, 0, 0, 0.25));
      }

      .flavor-bottle:focus {
        outline: 2px solid #3b82f6;
        outline-offset: 2px;
      }

      .flavor-bottle.paused {
        --animation-play-state: paused;
      }

      .flavor-bottle:not(.paused) {
        --animation-play-state: running;
      }

      .bottle-container {
        width: 100%;
        height: 100%;
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
      }

      .bottle-shadow {
        position: absolute;
        bottom: -8px;
        width: 60px;
        height: 12px;
        background: radial-gradient(
          ellipse,
          rgba(0, 0, 0, 0.2) 0%,
          transparent 70%
        );
        border-radius: 50%;
        animation: shadow-pulse 4s ease-in-out infinite;
        animation-play-state: var(--animation-play-state, running);
      }

      .bottle-wrapper {
        position: relative;
        animation: bottle-float 6s ease-in-out infinite;
        animation-play-state: var(--animation-play-state, running);
      }

      .bottle-cap {
        position: relative;
        z-index: 3;
      }

      .cap-top {
        width: 28px;
        height: 12px;
        background: linear-gradient(135deg, #4a5568, #2d3748);
        border-radius: 14px 14px 0 0;
        margin: 0 auto;
        box-shadow:
          0 2px 4px rgba(0, 0, 0, 0.3),
          inset 0 1px 2px rgba(255, 255, 255, 0.1);
      }

      .cap-rim {
        width: 32px;
        height: 4px;
        background: linear-gradient(135deg, #718096, #4a5568);
        border-radius: 2px;
        margin: 0 auto;
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
      }

      .bottle-neck {
        width: 20px;
        height: 24px;
        background: linear-gradient(
          135deg,
          rgba(255, 255, 255, 0.9),
          rgba(255, 255, 255, 0.7)
        );
        border-radius: 10px 10px 0 0;
        margin: 0 auto;
        position: relative;
        box-shadow:
          0 2px 4px rgba(0, 0, 0, 0.1),
          inset 0 1px 2px rgba(255, 255, 255, 0.8);
      }

      .neck-ring {
        position: absolute;
        bottom: 4px;
        left: 50%;
        transform: translateX(-50%);
        width: 16px;
        height: 3px;
        background: linear-gradient(
          135deg,
          rgba(255, 255, 255, 0.8),
          rgba(255, 255, 255, 0.4)
        );
        border-radius: 2px;
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
      }

      .bottle-body {
        width: 60px;
        height: 90px;
        border-radius: 12px 12px 30px 30px;
        position: relative;
        margin: 0 auto;
        box-shadow:
          0 8px 16px rgba(0, 0, 0, 0.3),
          inset 0 2px 4px rgba(255, 255, 255, 0.4),
          inset 0 -2px 4px rgba(0, 0, 0, 0.1);
        overflow: hidden;
        background-blend-mode: overlay;
        animation: bottle-spin 8s linear infinite;
        animation-play-state: var(--animation-play-state, running);
        background: linear-gradient(
          135deg,
          var(--bottle-primary, #3b82f6),
          var(--bottle-accent, #1d4ed8)
        );
      }

      .bottle-highlight {
        position: absolute;
        top: 8px;
        left: 8px;
        width: 20px;
        height: 30px;
        background: linear-gradient(
          135deg,
          rgba(255, 255, 255, 0.6),
          var(--bottle-accent, #1d4ed8),
          transparent
        );
        border-radius: 10px 0 0 10px;
        z-index: 1;
      }

      .bottle-label-sticker {
        position: absolute;
        top: 15px;
        left: 50%;
        transform: translateX(-50%);
        width: 45px;
        height: 50px;
        background: rgba(255, 255, 255, 0.95);
        border-radius: 6px;
        z-index: 2;
        box-shadow:
          0 2px 4px rgba(0, 0, 0, 0.2),
          inset 0 1px 2px rgba(255, 255, 255, 0.8);
        display: flex;
        align-items: center;
        justify-content: center;
        border: 1px solid rgba(0, 0, 0, 0.1);
      }

      .label-content {
        text-align: center;
        padding: 4px;
        width: 100%;
      }

      .brand-name {
        font-size: 0.5rem;
        font-weight: 900;
        color: #1a202c;
        letter-spacing: 0.5px;
        line-height: 1;
        margin-bottom: 2px;
      }

      .flavor-text {
        font-size: 0.45rem;
        font-weight: 700;
        color: #4a5568;
        line-height: 1;
        margin-bottom: 3px;
        text-transform: uppercase;
        letter-spacing: 0.3px;
      }

      .label-divider {
        width: 80%;
        height: 1px;
        background: linear-gradient(90deg, transparent, #cbd5e0, transparent);
        margin: 2px auto;
      }

      .product-info {
        display: flex;
        justify-content: space-between;
        font-size: 0.35rem;
        color: #718096;
        font-weight: 600;
        margin-top: 2px;
      }

      .volume,
      .calories {
        font-size: 0.35rem;
      }

      .bottle-content {
        position: relative;
        width: 100%;
        height: 100%;
        padding: 12px 8px;
        z-index: 1;
      }

      .bubbles {
        position: absolute;
        width: 100%;
        height: 100%;
        top: 0;
        left: 0;
        z-index: 1;
      }

      .bubble {
        position: absolute;
        background: radial-gradient(
          circle,
          rgba(255, 255, 255, 0.8) 0%,
          rgba(255, 255, 255, 0.3) 100%
        );
        border-radius: 50%;
        animation: bubble-rise 4s ease-in-out infinite;
        animation-play-state: var(--animation-play-state, running);
        box-shadow: 0 1px 2px rgba(255, 255, 255, 0.5);
      }

      .bubble-1 {
        width: 6px;
        height: 6px;
        left: 15%;
        animation-delay: 0s;
      }
      .bubble-2 {
        width: 4px;
        height: 4px;
        left: 35%;
        animation-delay: 0.7s;
      }
      .bubble-3 {
        width: 7px;
        height: 7px;
        left: 65%;
        animation-delay: 1.4s;
      }
      .bubble-4 {
        width: 3px;
        height: 3px;
        left: 85%;
        animation-delay: 2.1s;
      }
      .bubble-5 {
        width: 5px;
        height: 5px;
        left: 25%;
        animation-delay: 2.8s;
      }
      .bubble-6 {
        width: 4px;
        height: 4px;
        left: 75%;
        animation-delay: 3.5s;
      }
      .bubble-7 {
        width: 6px;
        height: 6px;
        left: 45%;
        animation-delay: 1.1s;
      }
      .bubble-8 {
        width: 5px;
        height: 5px;
        left: 95%;
        animation-delay: 1.8s;
      }

      .bottle-label {
        text-align: center;
        margin-top: 12px;
        color: #2d3748;
        text-shadow: 0 1px 2px rgba(255, 255, 255, 0.8);
        background: rgba(255, 255, 255, 0.9);
        padding: 6px 8px;
        border-radius: 8px;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        backdrop-filter: blur(4px);
      }

      .flavor-name {
        display: block;
        font-size: 0.75rem;
        font-weight: 700;
        line-height: 1.2;
        color: #1a202c;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .price {
        display: block;
        font-size: 0.625rem;
        font-weight: 600;
        color: #4a5568;
        margin-top: 2px;
      }

      @keyframes bottle-float {
        0%,
        100% {
          transform: translateY(0px) rotateY(0deg);
        }
        25% {
          transform: translateY(-6px) rotateY(15deg);
        }
        50% {
          transform: translateY(-3px) rotateY(0deg);
        }
        75% {
          transform: translateY(-9px) rotateY(-15deg);
        }
      }

      @keyframes bottle-spin {
        0% {
          transform: rotateY(0deg);
        }
        100% {
          transform: rotateY(360deg);
        }
      }

      @keyframes shadow-pulse {
        0%,
        100% {
          opacity: 0.6;
          transform: scaleX(1);
        }
        50% {
          opacity: 0.3;
          transform: scaleX(0.8);
        }
      }

      @keyframes bubble-rise {
        0% {
          transform: translateY(70px) scale(0);
          opacity: 0;
        }
        15% {
          opacity: 1;
          transform: translateY(60px) scale(0.5);
        }
        85% {
          opacity: 1;
          transform: translateY(-10px) scale(1);
        }
        100% {
          transform: translateY(-20px) scale(0.8);
          opacity: 0;
        }
      }
    </style>
  </template>
}

class SparklingWaterCatalogIsolatedTemplate extends Component<
  typeof SparklingWaterCatalog
> {
  @tracked spinning3D = true;
  @tracked selectedFlavor: SparkleFlavor | null = null;

  get brandTitle() {
    return this.args.model?.brandName ?? 'Bupples';
  }

  get flavorCount() {
    return this.args.model?.featuredFlavors?.length ?? 0;
  }

  get paused() {
    return !this.spinning3D;
  }

  @action
  toggleSpin() {
    this.spinning3D = !this.spinning3D;
  }

  @action
  selectFlavor(flavor: SparkleFlavor) {
    this.selectedFlavor = this.selectedFlavor === flavor ? null : flavor;
  }

  <template>
    <div class='stage'>
      <header class='catalog-header'>
        <div class='brand-logo'>
          <DropletIcon width='48' height='48' />
          <h1 class='brand-title'>{{this.brandTitle}}</h1>
        </div>

        {{#if @model.description}}
          <div class='brand-description'>
            <@fields.description />
          </div>
        {{else}}
          <p class='brand-placeholder'>Refreshingly crisp sparkling water with
            natural flavors</p>
        {{/if}}
      </header>

      <div class='showcase-controls'>
        <button
          class='spin-toggle {{if this.spinning3D "active" ""}}'
          {{on 'click' this.toggleSpin}}
        >
          {{if this.spinning3D '⏸️ Pause Spin' '▶️ Start Spin'}}
        </button>

        <div class='flavor-counter'>
          {{if
            (gt this.flavorCount 0)
            (concat this.flavorCount ' Premium Flavors')
            'Loading flavors...'
          }}
        </div>
      </div>

      {{#if (gt @model.featuredFlavors.length 0)}}
        <section class='flavor-showcase'>
          <h2>🌟 Featured Collection</h2>
          <div class='bottles-3d {{unless this.spinning3D "paused"}}'>
            {{#each @model.featuredFlavors as |flavor|}}
              <div class='bottle-slot'>
                <SparkleFlavorBottle
                  @flavor={{flavor}}
                  @pauseAnimation={{this.paused}}
                  @onClick={{fn this.selectFlavor flavor}}
                />
              </div>
            {{/each}}
          </div>
        </section>
      {{else}}
        <section class='empty-showcase'>
          <div class='empty-state'>
            <DropletIcon width='64' height='64' />
            <h3>No flavors added yet.</h3>
            <p>Add some delicious Bupples flavors to see the 3D showcase!</p>
          </div>
        </section>
      {{/if}}

      {{#if this.selectedFlavor}}
        <section class='flavor-details-panel'>
          <h3>🔍 Flavor Spotlight</h3>
          <div class='flavor-spotlight-card'>
            <div class='flavor-spotlight-bottle'>
              <SparkleFlavorBottle
                @flavor={{this.selectedFlavor}}
                @pauseAnimation={{this.paused}}
              />
            </div>
            <div class='flavor-spotlight-details'>
              <h4
                class='flavor-spotlight-title'
              >{{this.selectedFlavor.title}}</h4>
              {{#if this.selectedFlavor.description}}
                <div class='flavor-spotlight-description'>
                  {{this.selectedFlavor.description}}
                </div>
              {{/if}}
              <div class='flavor-spotlight-meta'>
                <div class='flavor-spotlight-intensity'>
                  <span>Intensity:</span>
                  <span>
                    {{#each (array 5) as |_ index|}}
                      <span
                        class='spotlight-bar
                          {{if
                            (gt this.selectedFlavor.intensity index)
                            "active"
                            ""
                          }}'
                      ></span>
                    {{/each}}
                  </span>
                </div>
                <div class='flavor-spotlight-price'>
                  {{#if this.selectedFlavor.price}}
                    <span>Price: &#36;{{this.selectedFlavor.price}}</span>
                  {{else}}
                    <span>Price available in stores</span>
                  {{/if}}
                </div>
              </div>
            </div>
          </div>
        </section>
      {{/if}}

      {{#if (gt @model.featuredFlavors.length 0)}}
        <section class='flavors-grid-section'>
          <h2>🎨 All Flavors</h2>
          <@fields.featuredFlavors @format='embedded' />
        </section>
      {{/if}}
    </div>

    <style scoped>
      .stage {
        width: 100%;
        min-height: 100vh;
        background: linear-gradient(
          135deg,
          #667eea 0%,
          #764ba2 50%,
          #f093fb 100%
        );
        background-attachment: fixed;
        padding: 2rem;
        overflow-y: auto;
      }

      .catalog-header {
        text-align: center;
        color: white;
        margin-bottom: 3rem;
      }

      .brand-logo {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 1rem;
        margin-bottom: 1rem;
      }

      .brand-title {
        font-size: 3rem;
        font-weight: 800;
        margin: 0;
        text-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
        background: linear-gradient(45deg, #fff, #e0e7ff);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
      }

      .brand-description {
        max-width: 600px;
        margin: 0 auto;
        font-size: 1.125rem;
        line-height: 1.6;
        width: 100%;
      }

      .brand-placeholder {
        color: rgba(255, 255, 255, 0.8);
        font-style: italic;
        font-size: 1.125rem;
        max-width: 600px;
        margin: 0 auto;
      }

      .showcase-controls {
        display: flex;
        justify-content: center;
        align-items: center;
        gap: 2rem;
        margin-bottom: 3rem;
      }

      .spin-toggle {
        padding: 0.75rem 1.5rem;
        background: rgba(255, 255, 255, 0.2);
        border: 2px solid rgba(255, 255, 255, 0.3);
        border-radius: 2rem;
        color: white;
        font-weight: 600;
        cursor: pointer;
        backdrop-filter: blur(10px);
        transition: all 0.3s ease;
      }

      .spin-toggle:hover {
        background: rgba(255, 255, 255, 0.3);
        transform: translateY(-2px);
      }

      .spin-toggle.active {
        background: rgba(34, 197, 94, 0.3);
        border-color: rgba(34, 197, 94, 0.5);
      }

      .flavor-counter {
        color: white;
        font-size: 1.125rem;
        font-weight: 600;
        text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
      }

      .flavor-showcase {
        margin-bottom: 6rem;
        text-align: center;
      }

      .flavor-showcase h2 {
        color: white;
        font-size: 2rem;
        margin-bottom: 2rem;
        text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
      }

      .bottles-3d {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
        gap: 1.5rem;
        max-width: 800px;
        margin: 0 auto;
        perspective: 1000px;
      }

      .bottle-slot {
        height: 120px;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .empty-showcase {
        text-align: center;
        padding: 4rem 2rem;
      }

      .empty-state {
        background: rgba(255, 255, 255, 0.1);
        padding: 3rem;
        border-radius: 2rem;
        backdrop-filter: blur(10px);
        border: 1px solid rgba(255, 255, 255, 0.2);
        max-width: 400px;
        margin: 0 auto;
      }

      .empty-state svg {
        opacity: 0.6;
        margin-bottom: 1rem;
      }

      .empty-state h3 {
        color: white;
        margin: 1rem 0 0.5rem;
        font-size: 1.5rem;
      }

      .empty-state p {
        color: rgba(255, 255, 255, 0.8);
        margin: 0;
      }

      .flavor-details-panel {
        margin-bottom: 3rem;
        text-align: center;
      }

      .flavor-details-panel h3 {
        color: white;
        font-size: 1.75rem;
        margin-bottom: 1.5rem;
        text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
      }

      .selected-flavor {
        max-width: 400px;
        margin: 0 auto;
      }

      .flavors-grid-section {
        background: rgba(255, 255, 255, 0.1);
        padding: 3rem;
        border-radius: 2rem;
        backdrop-filter: blur(10px);
        border: 1px solid rgba(255, 255, 255, 0.2);
      }

      .flavors-grid-section h2 {
        color: white;
        text-align: center;
        margin-bottom: 2rem;
        font-size: 2rem;
        text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
      }

      .flavors-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 2rem;
      }

      .flavors-grid > * + * {
        margin-top: 0; /* Override auto-spacing for grid */
      }

      .flavor-spotlight-card {
        display: flex;
        flex-direction: row;
        align-items: stretch;
        background: rgba(255, 255, 255, 0.15);
        border-radius: 1.5rem;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
        padding: 2rem;
        gap: 2rem;
        max-width: 700px;
        margin: 0 auto 2rem auto;
        backdrop-filter: blur(8px);
        border: 1px solid rgba(255, 255, 255, 0.18);
      }
      .flavor-spotlight-bottle {
        flex: 0 0 160px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .flavor-spotlight-details {
        flex: 1 1 0%;
        display: flex;
        flex-direction: column;
        justify-content: center;
        color: #fff;
      }
      .flavor-spotlight-title {
        font-size: 2rem;
        font-weight: 800;
        margin: 0 0 1rem 0;
        text-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
      }
      .flavor-spotlight-description {
        font-size: 1.1rem;
        margin-bottom: 1.5rem;
        color: #e0e7ff;
      }
      .flavor-spotlight-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 2rem;
        align-items: center;
      }
      .flavor-spotlight-intensity {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 1rem;
      }
      .spotlight-bar {
        display: inline-block;
        width: 16px;
        height: 12px;
        border-radius: 2px;
        background: #e5e7eb;
        margin-right: 2px;
        transition: background 0.2s;
      }
      .spotlight-bar.active {
        background: #3b82f6;
      }
      .flavor-spotlight-price {
        font-size: 1.1rem;
        font-weight: 700;
        color: #bbf7d0;
      }
      @media (max-width: 700px) {
        .flavor-spotlight-card {
          flex-direction: column;
          align-items: center;
          padding: 1.2rem;
          gap: 1.2rem;
        }
        .flavor-spotlight-bottle {
          flex: none;
        }
        .flavor-spotlight-details {
          align-items: center;
          text-align: center;
        }
      }
    </style>
  </template>
}

export class SparkleFlavor extends CardDef {
  static displayName = 'Sparkle Flavor';
  static icon = DropletIcon;

  @field flavorName = contains(StringField);
  @field description = contains(MarkdownField);
  @field primaryColor = contains(ColorField);
  @field accentColor = contains(ColorField);
  @field intensity = contains(NumberField);
  @field price = contains(NumberField);

  @field title = contains(StringField, {
    computeVia: function (this: SparkleFlavor) {
      const name = this.flavorName ?? 'Mystery Flavor';
      const price = this.price ? ` - $${this.price.toFixed(2)}` : '';
      return `${name}${price}`;
    },
  });

  static embedded = class Embedded extends Component<typeof SparkleFlavor> {
    <template>
      <div class='flavor-card'>
        <div class='flavor-header'>
          <h3 class='flavor-name'>{{if
              @model.flavorName
              @model.flavorName
              'Mystery Flavor'
            }}</h3>
        </div>

        <div class='flavor-details'>
          {{#if @model.description}}
            <div class='description'>
              <@fields.description />
            </div>
          {{else}}
            <p class='placeholder'>A delightfully refreshing sparkling water
              experience</p>
          {{/if}}

          <div class='intensity-meter'>
            <span>Intensity:</span>
            <div class='intensity-bars'>
              {{#each (array 5) as |_ index|}}
                <div class='bar {{if (gt @model.intensity index) "active" ""}}'>
                </div>
              {{/each}}
            </div>
          </div>

          {{#if @model.price}}
            <div class='price'>{{currencyFormat @model.price}}</div>
          {{else}}
            <div class='price-placeholder'>Price available in stores</div>
          {{/if}}
        </div>
      </div>

      <style scoped>
        .flavor-card {
          border: 3px solid #e5e7eb;
          border-radius: 1rem;
          overflow: hidden;
          background: white;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
          transition:
            transform 0.2s,
            box-shadow 0.2s;
          height: 280px;
          display: flex;
          flex-direction: column;
        }

        .flavor-card:hover {
          transform: translateY(-4px);
          box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.2);
        }

        .flavor-header {
          padding: 1rem;
          color: white;
          text-align: center;
          flex-shrink: 0;
          background: linear-gradient(135deg, #3b82f6, #1d4ed8);
        }

        .flavor-name {
          margin: 0;
          font-size: 1.125rem;
          font-weight: 700;
          text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
        }

        .flavor-details {
          padding: 1rem;
          flex: 1;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
        }

        .description {
          font-size: 0.875rem;
          line-height: 1.4;
          color: #374151;
        }

        .placeholder,
        .price-placeholder {
          color: #9ca3af;
          font-style: italic;
          font-size: 0.875rem;
        }

        .intensity-meter {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.875rem;
          color: #6b7280;
        }

        .intensity-bars {
          display: flex;
          gap: 0.25rem;
        }

        .bar {
          width: 12px;
          height: 12px;
          border-radius: 2px;
          background-color: #e5e7eb;
          transition: background-color 0.2s;
        }

        .bar.active {
          background-color: #3b82f6;
        }

        .price {
          font-size: 1.125rem;
          font-weight: 700;
          color: #059669;
          text-align: center;
        }
      </style>
    </template>
  };
}

export class SparklingWaterCatalog extends CardDef {
  static displayName = 'Bupples Sparkling Water Catalog';
  static icon = DropletIcon;
  static prefersWideFormat = true;

  @field brandName = contains(StringField);
  @field description = contains(MarkdownField);
  @field featuredFlavors = linksToMany(SparkleFlavor);

  @field title = contains(StringField, {
    computeVia: function (this: SparklingWaterCatalog) {
      const brand = this.brandName ?? 'Bupples';
      return `${brand} Sparkling Water Collection`;
    },
  });

  static isolated = SparklingWaterCatalogIsolatedTemplate;
}
