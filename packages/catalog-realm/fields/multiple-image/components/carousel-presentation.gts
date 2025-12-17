import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { eq, not } from '@cardstack/boxel-ui/helpers';
import { Pill } from '@cardstack/boxel-ui/components';
import ChevronLeftIcon from '@cardstack/boxel-icons/chevron-left';
import ChevronRightIcon from '@cardstack/boxel-icons/chevron-right';
import ImageField from '../../image';

interface CarouselPresentationSignature {
  Args: {
    images?: ImageField[];
  };
}

export default class CarouselPresentation extends GlimmerComponent<CarouselPresentationSignature> {
  @tracked selectedIndex = 0;

  get selectedImage() {
    return (this.args.images || [])[this.selectedIndex];
  }

  get canGoPrev() {
    return this.selectedIndex > 0;
  }

  get canGoNext() {
    return this.selectedIndex < ((this.args.images || []).length || 0) - 1;
  }

  get hasMultipleImages() {
    return ((this.args.images || []).length || 0) > 1;
  }

  get totalImages() {
    return (this.args.images || []).length || 0;
  }

  get paginationText() {
    return `${this.selectedIndex + 1}/${this.totalImages}`;
  }

  @action
  selectImage(index: number) {
    this.selectedIndex = index;
  }

  @action
  goToPrev() {
    if (this.canGoPrev) {
      this.selectedIndex--;
    }
  }

  @action
  goToNext() {
    if (this.canGoNext) {
      this.selectedIndex++;
    }
  }

  <template>
    <div class='carousel-container'>
      <div class='main-banner'>
        <img src={{this.selectedImage.url}} alt='' class='banner-image' />
        {{! Pagination pill }}
        {{#if this.hasMultipleImages}}
          <div class='pagination-pill'>
            <Pill @variant='muted' @tag='span' class='small-pill'>
              {{this.paginationText}}
            </Pill>
          </div>
        {{/if}}
        {{! Carousel navigation }}
        {{#if this.hasMultipleImages}}
          <button
            type='button'
            class='carousel-nav prev {{unless this.canGoPrev "disabled"}}'
            {{on 'click' this.goToPrev}}
            disabled={{not this.canGoPrev}}
          >
            <ChevronLeftIcon class='nav-icon' />
          </button>
          <button
            type='button'
            class='carousel-nav next {{unless this.canGoNext "disabled"}}'
            {{on 'click' this.goToNext}}
            disabled={{not this.canGoNext}}
          >
            <ChevronRightIcon class='nav-icon' />
          </button>
        {{/if}}
      </div>
      {{! Thumbnail strip }}
      {{#if this.hasMultipleImages}}
        <div class='thumbnails-strip'>
          {{#each @images as |image index|}}
            <button
              type='button'
              class='thumbnail {{if (eq index this.selectedIndex) "active"}}'
              {{on 'click' (fn this.selectImage index)}}
            >
              <img src={{image.url}} alt='Thumbnail' class='thumbnail-image' />
            </button>
          {{/each}}
        </div>
      {{/if}}
    </div>

    <style scoped>
      .carousel-container {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }

      .main-banner {
        position: relative;
        width: 100%;
        aspect-ratio: 1 / 1;
        background: var(--muted, var(--boxel-light));
        border: 2px solid var(--border, #e5e7eb);
        border-radius: var(--radius, 0.5rem);
        overflow: hidden;
      }

      .banner-image {
        width: 100%;
        height: 100%;
        object-fit: contain;
      }

      .carousel-nav {
        position: absolute;
        top: 50%;
        transform: translateY(-50%);
        width: 2.5rem;
        height: 2.5rem;
        background: color-mix(
          in srgb,
          var(--background, #ffffff) 90%,
          transparent
        );
        border: none;
        border-radius: 9999px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.2s ease;
        box-shadow: var(--shadow-lg, 0 10px 15px -3px rgb(0 0 0 / 0.1));
      }

      .carousel-nav:hover:not(.disabled) {
        background: var(--background, #ffffff);
        transform: translateY(-50%) scale(1.1);
      }

      .carousel-nav.prev {
        left: 0.75rem;
      }

      .carousel-nav.next {
        right: 0.75rem;
      }

      .carousel-nav.disabled {
        opacity: 0.3;
        cursor: not-allowed;
      }

      .nav-icon {
        width: 1.25rem;
        height: 1.25rem;
        color: var(--foreground, #1a1a1a);
      }

      .thumbnails-strip {
        display: flex;
        gap: 0.5rem;
        overflow-x: auto;
        padding: 0.25rem;
      }

      .thumbnail {
        flex-shrink: 0;
        width: 4rem;
        height: 4rem;
        border: 2px solid var(--border, #e5e7eb);
        border-radius: var(--radius, 0.375rem);
        overflow: hidden;
        cursor: pointer;
        transition: all 0.2s ease;
        background: var(--boxel-light);
        padding: 0;
      }

      .thumbnail:hover {
        border-color: var(--primary, #3b82f6);
      }

      .thumbnail.active {
        border-color: var(--primary, #3b82f6);
        box-shadow: 0 0 0 1px var(--primary, #3b82f6);
      }

      .thumbnail-image {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      /* Pagination pill */
      .pagination-pill {
        position: absolute;
        top: 0.75rem;
        left: 0.75rem;
        z-index: 2;
      }

      .small-pill {
        font-size: 0.75rem;
        padding: 0.25rem 0.5rem;
      }
    </style>
  </template>
}
