import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { eq } from '@cardstack/boxel-ui/helpers';

// Photo Organizer — the edit-side companion to PropertyGallery. Reordering,
// hero selection, and captions all live here so the three stay coupled: a
// reorder moves the photo, its caption, and the hero mark together, which a
// parallel-array model cannot guarantee if each is edited on its own.
// Mutates the passed model directly (containsMany arrays replace
// wholesale — the MultiImageSourceField editor's own idiom).

// Structural type instead of importing PropertyListing — this component is
// consumed by property-listing.gts, so a real import would be a cycle.
interface OrganizerModel {
  photos?: {
    resolvedUrls?: string[];
    images?: any[];
  };
  photoCaptions?: string[];
  heroIndex?: number | null;
}

interface Signature {
  Args: {
    model: OrganizerModel | undefined;
  };
  Element: HTMLElement;
}

export class PhotoOrganizer extends GlimmerComponent<Signature> {
  @tracked dragIndex: number | undefined;

  get urls(): string[] {
    return (this.args.model?.photos?.resolvedUrls ?? []).filter(Boolean);
  }

  get heroIndex(): number {
    let hero = this.args.model?.heroIndex ?? 0;
    return Math.max(0, Math.min(hero, this.urls.length - 1));
  }

  captionAt = (index: number): string => {
    return this.args.model?.photoCaptions?.[index] ?? '';
  };

  /** Captions padded to the photo count, so index writes are stable. */
  private paddedCaptions(length: number): string[] {
    let current = this.args.model?.photoCaptions ?? [];
    return Array.from({ length }, (_, i) => current[i] ?? '');
  }

  setCaption = (index: number, event: Event) => {
    let model = this.args.model;
    if (!model) {
      return;
    }
    let value = (event.target as HTMLInputElement).value;
    let captions = this.paddedCaptions(this.urls.length);
    captions[index] = value;
    model.photoCaptions = captions;
  };

  setHero = (index: number) => {
    let model = this.args.model;
    if (!model) {
      return;
    }
    model.heroIndex = index;
  };

  /** Move the photo at `from` to position `to`, carrying caption and hero. */
  reorder = (from: number, to: number) => {
    let model = this.args.model;
    let images = model?.photos?.images;
    if (!model || !images || from === to || from < 0 || to < 0) {
      return;
    }
    if (from >= images.length || to >= images.length) {
      return;
    }
    let nextImages = [...images];
    let [moved] = nextImages.splice(from, 1);
    nextImages.splice(to, 0, moved);

    let captions = this.paddedCaptions(images.length);
    let [movedCaption] = captions.splice(from, 1);
    captions.splice(to, 0, movedCaption);

    let hero = this.heroIndex;
    let nextHero = hero;
    if (hero === from) {
      nextHero = to;
    } else if (from < hero && hero <= to) {
      nextHero = hero - 1;
    } else if (to <= hero && hero < from) {
      nextHero = hero + 1;
    }

    model.photos!.images = nextImages;
    model.photoCaptions = captions;
    model.heroIndex = nextHero;
  };

  moveLeft = (index: number) => {
    this.reorder(index, index - 1);
  };

  moveRight = (index: number) => {
    this.reorder(index, index + 1);
  };

  onDragStart = (index: number, event: DragEvent) => {
    this.dragIndex = index;
    event.dataTransfer?.setData('text/plain', String(index));
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
    }
  };

  onDragOver = (event: DragEvent) => {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  };

  onDrop = (index: number, event: DragEvent) => {
    event.preventDefault();
    let from = this.dragIndex;
    this.dragIndex = undefined;
    if (from !== undefined) {
      this.reorder(from, index);
    }
  };

  onDragEnd = () => {
    this.dragIndex = undefined;
  };

  get lastIndex() {
    return this.urls.length - 1;
  }

  <template>
    {{#if this.urls.length}}
      <ul class='organizer' ...attributes>
        {{#each this.urls as |url index|}}
          <li
            class='item {{if (eq index this.dragIndex) "dragging"}}'
            draggable='true'
            {{on 'dragstart' (fn this.onDragStart index)}}
            {{on 'dragover' this.onDragOver}}
            {{on 'drop' (fn this.onDrop index)}}
            {{on 'dragend' this.onDragEnd}}
          >
            <div class='thumb-wrap'>
              <img src={{url}} alt='Photo {{index}}' loading='lazy' />
              {{#if (eq index this.heroIndex)}}
                <span class='hero-badge'>HERO</span>
              {{/if}}
            </div>
            <input
              class='caption-input'
              type='text'
              placeholder='Caption'
              value={{this.captionAt index}}
              aria-label='Caption for photo {{index}}'
              {{on 'change' (fn this.setCaption index)}}
            />
            <div class='controls'>
              <button
                type='button'
                class='ctl'
                aria-label='Move photo {{index}} left'
                disabled={{eq index 0}}
                {{on 'click' (fn this.moveLeft index)}}
              >‹</button>
              <button
                type='button'
                class='ctl hero-ctl {{if (eq index this.heroIndex) "is-hero"}}'
                disabled={{eq index this.heroIndex}}
                {{on 'click' (fn this.setHero index)}}
              >
                {{if (eq index this.heroIndex) 'Hero' 'Set as hero'}}
              </button>
              <button
                type='button'
                class='ctl'
                aria-label='Move photo {{index}} right'
                disabled={{eq index this.lastIndex}}
                {{on 'click' (fn this.moveRight index)}}
              >›</button>
            </div>
          </li>
        {{/each}}
      </ul>
    {{/if}}
    <style scoped>
      .organizer {
        display: flex;
        gap: var(--boxel-sp-xs);
        overflow-x: auto;
        margin: 0;
        padding: var(--boxel-sp-5xs) 0;
        list-style: none;
      }
      .item {
        flex: 0 0 auto;
        width: 9.5rem;
        display: grid;
        gap: var(--boxel-sp-5xs);
        border: 1px solid var(--border, var(--boxel-200));
        border-radius: var(--radius, var(--boxel-border-radius));
        padding: var(--boxel-sp-5xs);
        background: var(--card, transparent);
        cursor: grab;
      }
      .item.dragging {
        opacity: 0.5;
      }
      .thumb-wrap {
        position: relative;
        border-radius: calc(var(--radius, var(--boxel-border-radius)) / 1.5);
        overflow: hidden;
        aspect-ratio: 16 / 10;
        background: var(--muted, var(--boxel-100));
      }
      .thumb-wrap img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }
      .hero-badge {
        position: absolute;
        top: 4px;
        left: 4px;
        font-size: 0.5625rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        padding: 1px 6px;
        border-radius: 999px;
        background: var(--foreground, var(--boxel-dark));
        color: var(--background, var(--boxel-light));
      }
      .caption-input {
        font: inherit;
        font-size: 0.75rem;
        padding: 2px 6px;
        border: 1px solid var(--border, var(--boxel-200));
        border-radius: calc(var(--radius, var(--boxel-border-radius)) / 2);
        background: var(--background, var(--boxel-light));
        color: var(--foreground, var(--boxel-dark));
        min-width: 0;
      }
      .controls {
        display: flex;
        gap: var(--boxel-sp-6xs, 2px);
        align-items: center;
      }
      .ctl {
        border: 1px solid var(--border, var(--boxel-200));
        border-radius: calc(var(--radius, var(--boxel-border-radius)) / 2);
        background: none;
        font: inherit;
        font-size: 0.6875rem;
        padding: 1px 6px;
        cursor: pointer;
        color: var(--muted-foreground, var(--boxel-450));
      }
      .ctl:hover:not(:disabled) {
        color: var(--foreground, var(--boxel-dark));
      }
      .ctl:disabled {
        opacity: 0.45;
        cursor: default;
      }
      .hero-ctl {
        flex: 1;
      }
      .hero-ctl.is-hero {
        color: var(--foreground, var(--boxel-dark));
        font-weight: 600;
        opacity: 1;
      }
    </style>
  </template>
}
