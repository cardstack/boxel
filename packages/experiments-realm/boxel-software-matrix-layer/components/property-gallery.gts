import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { eq } from '@cardstack/boxel-ui/helpers';

// Property Gallery — hero-plus-filmstrip photo viewer for a property
// listing. Render-only and domain-neutral about storage: the consumer
// hands it resolved image URLs (Property Listing feeds it
// MultiImageSourceField.resolvedUrls); the gallery owns selection state,
// the empty state, and keyboard-reachable thumbnails, nothing else.

interface Signature {
  Args: {
    urls: string[] | undefined;
    alt?: string;
  };
  Element: HTMLElement;
}

export class PropertyGallery extends GlimmerComponent<Signature> {
  @tracked selectedIndex = 0;

  get urls(): string[] {
    return (this.args.urls ?? []).filter(Boolean);
  }

  get selectedUrl(): string | undefined {
    return this.urls[this.selectedIndex] ?? this.urls[0];
  }

  select = (index: number) => {
    this.selectedIndex = index;
  };

  indexOf = (url: string) => this.urls.indexOf(url);

  get hasMultiple() {
    return this.urls.length > 1;
  }

  get selectedIndexDisplay() {
    return Math.min(this.selectedIndex, this.urls.length - 1) + 1;
  }

  <template>
    <div class='gallery' ...attributes>
      {{#if this.urls.length}}
        <figure class='hero'>
          <img src={{this.selectedUrl}} alt={{if @alt @alt 'Property photo'}} />
          <figcaption class='counter'>{{this.selectedIndexDisplay}} /
            {{this.urls.length}}</figcaption>
        </figure>
        {{#if this.hasMultiple}}
          <div class='strip' role='tablist' aria-label='Property photos'>
            {{#each this.urls as |url index|}}
              <button
                type='button'
                role='tab'
                aria-selected='{{if (eq index this.selectedIndex) "true" "false"}}'
                class='thumb {{if (eq index this.selectedIndex) "active"}}'
                {{on 'click' (fn this.select index)}}
              >
                <img src={{url}} alt='Photo {{index}}' loading='lazy' />
              </button>
            {{/each}}
          </div>
        {{/if}}
      {{else}}
        <div class='empty'>
          <span class='empty-glyph' aria-hidden='true'>🏠</span>
          <p>No photos yet — a listing without photos does not get
            viewings.</p>
        </div>
      {{/if}}
    </div>
    <style scoped>
      .gallery {
        display: grid;
        gap: var(--boxel-sp-xs);
      }
      .hero {
        margin: 0;
        position: relative;
        border-radius: var(--radius, var(--boxel-border-radius));
        overflow: hidden;
        aspect-ratio: 16 / 10;
        background: var(--muted, var(--boxel-100));
      }
      .hero img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }
      .counter {
        position: absolute;
        right: var(--boxel-sp-xs);
        bottom: var(--boxel-sp-xs);
        background: color-mix(in oklch, black 55%, transparent);
        color: white;
        font-size: 0.75rem;
        padding: 2px 8px;
        border-radius: 999px;
        font-variant-numeric: tabular-nums;
      }
      .strip {
        display: flex;
        gap: var(--boxel-sp-5xs);
        overflow-x: auto;
        padding-bottom: 2px;
      }
      .thumb {
        flex: 0 0 auto;
        width: 72px;
        height: 48px;
        padding: 0;
        border: 2px solid transparent;
        border-radius: calc(var(--radius, var(--boxel-border-radius)) / 1.5);
        overflow: hidden;
        cursor: pointer;
        background: none;
        opacity: 0.7;
      }
      .thumb img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }
      .thumb.active {
        border-color: var(--primary, var(--boxel-highlight));
        opacity: 1;
      }
      .thumb:hover {
        opacity: 1;
      }
      .empty {
        border: 1px dashed var(--border, var(--boxel-300));
        border-radius: var(--radius, var(--boxel-border-radius));
        padding: var(--boxel-sp-xl);
        text-align: center;
        color: var(--muted-foreground, var(--boxel-450));
      }
      .empty-glyph {
        font-size: 1.75rem;
        display: block;
        margin-bottom: var(--boxel-sp-xs);
      }
      .empty p {
        margin: 0;
        font-size: 0.875rem;
        font-style: italic;
      }
    </style>
  </template>
}
