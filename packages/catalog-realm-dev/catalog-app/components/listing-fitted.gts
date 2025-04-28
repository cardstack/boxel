import {
  Component,
  CardDef,
  CardContext,
} from 'https://cardstack.com/base/card-api';
import GlimmerComponent from '@glimmer/component';
// @ts-ignore
import type { ComponentLike } from '@glint/template';
// @ts-ignore
import cssUrl from 'ember-css-url';

import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { add, eq } from '@cardstack/boxel-ui/helpers';
import { fn } from '@ember/helper';

import { type Listing } from '../listing/listing';

import { BoxelButton } from '@cardstack/boxel-ui/components';

interface Signature {
  Element: HTMLElement;
  Args: {
    context: CardContext | undefined;
    items: string[];
    examples?: CardDef[];
  };
}

class CarouselComponent extends GlimmerComponent<Signature> {
  @tracked currentIndex = 0;

  get totalSlides() {
    return this.args.items?.length ?? 0;
  }

  get prevIndex() {
    return this.currentIndex === 0
      ? this.totalSlides - 1
      : this.currentIndex - 1;
  }

  get nextIndex() {
    return this.currentIndex === this.totalSlides - 1
      ? 0
      : this.currentIndex + 1;
  }

  get hasSlide() {
    return this.totalSlides > 0;
  }

  get hasMultipleSlides() {
    return this.totalSlides > 1;
  }

  get hasExample() {
    return this.args.examples && this.args.examples.length > 0;
  }

  @action
  stopPropagation(e: MouseEvent) {
    e.stopPropagation();
  }

  @action preview(e: MouseEvent) {
    e.stopPropagation();

    if (!this.hasExample) {
      throw new Error('No valid example found to preview');
    }

    this.args.context?.actions?.viewCard?.(this.args.examples![0]);
  }

  @action
  updateCurrentIndex(index: number, e: MouseEvent) {
    e.stopPropagation();
    if (index < 0 || index >= this.totalSlides) {
      return;
    }
    this.currentIndex = index;
  }

  <template>
    <div class='carousel'>
      {{#if this.hasExample}}
        <div class='preview-button-container'>
          <BoxelButton
            @kind='secondary-dark'
            class='preview-button'
            {{on 'click' this.preview}}
            aria-label='Preview'
          >
            Preview
          </BoxelButton>
        </div>
      {{/if}}

      <div class='carousel-items'>
        {{#each @items as |item index|}}
          <div
            class='carousel-item
              {{if (eq this.currentIndex index) "is-active"}}'
            aria-hidden={{if (eq this.currentIndex index) 'false' 'true'}}
          >
            <img
              src={{item}}
              alt='Slide {{add index 1}} of {{this.totalSlides}}'
            />
          </div>
        {{/each}}
      </div>

      {{#if this.hasMultipleSlides}}
        <div
          class='carousel-nav'
          role='presentation'
          {{on 'mouseenter' this.stopPropagation}}
        >
          <div
            class='carousel-arrow carousel-arrow-prev'
            {{on 'click' (fn this.updateCurrentIndex this.prevIndex)}}
            role='button'
            aria-label='Previous slide'
          >
            &#10094;
          </div>
          <div
            class='carousel-arrow carousel-arrow-next'
            {{on 'click' (fn this.updateCurrentIndex this.nextIndex)}}
            role='button'
            aria-label='Next slide'
          >
            &#10095;
          </div>
        </div>
      {{/if}}

      {{#if this.hasMultipleSlides}}
        <div
          class='carousel-dots'
          role='presentation'
          {{on 'mouseenter' this.stopPropagation}}
        >
          {{#each @items as |_ index|}}
            <div
              class='carousel-dot
                {{if (eq this.currentIndex index) "is-active"}}'
              {{on 'click' (fn this.updateCurrentIndex index)}}
              role='button'
              aria-label='Go to slide {{add index 1}}'
            />
          {{/each}}
        </div>
      {{/if}}
    </div>

    <style scoped>
      @layer {
        .carousel {
          --boxel-carousel-z-index: 1;
          position: relative;
          width: 100%;
          height: 100%;
          overflow: hidden;
          container-type: inline-size;
          outline: none;
        }
        .carousel:focus-visible {
          outline: 2px solid var(--boxel-highlight);
          outline-offset: 2px;
        }
        .carousel-items {
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
        }
        .carousel-item {
          position: absolute;
          visibility: hidden;
          flex: 0 0 100%;
          justify-content: center;
          align-items: center;
          padding: var(--boxel-sp) var(--boxel-sp-xs);
          display: flex;
          opacity: 0;
          transition:
            opacity 1s ease,
            visibility 0s linear 1s;
        }
        .carousel-item.is-active {
          visibility: visible;
          opacity: 1;
          transition:
            opacity 1s ease,
            visibility 0s;
        }
        .carousel-item img {
          width: 100%;
          height: auto;
          object-fit: cover;
          display: block;
          border-radius: var(--boxel-border-radius-sm);
          box-shadow:
            0 15px 20px rgba(0, 0, 0, 0.12),
            0 5px 10px rgba(0, 0, 0, 0.1);
        }

        .carousel-arrow {
          cursor: pointer;
          user-select: none;
          padding: 0px;
          width: 2rem;
          height: 2rem;
          display: inline-flex;
          justify-content: center;
          align-items: center;
        }
        .carousel-arrow-prev {
          position: absolute;
          left: 0;
          top: 50%;
          transform: translateY(-50%);
          z-index: calc(var(--boxel-carousel-z-index));
        }
        .carousel-arrow-next {
          position: absolute;
          right: 0;
          top: 50%;
          transform: translateY(-50%);
          z-index: calc(var(--boxel-carousel-z-index));
        }

        .carousel-arrow-next {
          position: absolute;
          right: 0;
          top: 50%;
          transform: translateY(-50%);
        }
        .carousel-dots {
          position: absolute;
          bottom: 5px;
          left: 50%;
          z-index: var(--boxel-carousel-z-index);
          transform: translateX(-50%);
          display: flex;
          justify-content: center;
          gap: 0.5rem;
        }
        .carousel-dot {
          width: 10px;
          height: 10px;
          background-color: var(--boxel-100);
          border: 1px solid var(--boxel-500);
          border-radius: 50%;
          cursor: pointer;
          padding: 0px;
        }
        .carousel-dot.is-active {
          background-color: var(--boxel-400);
          border: 1px solid var(--boxel-700);
        }

        .preview-button-container {
          position: absolute;
          top: 0;
          left: 0;
          z-index: var(--boxel-carousel-z-index);
          width: 100%;
          height: 100%;
          display: flex;
          justify-content: center;
          align-items: center;
          opacity: 0;
          background-color: rgba(0, 0, 0, 0.5);
          transition: opacity 0.3s ease;
        }

        .carousel:hover .carousel-item img {
          box-shadow:
            0 15px 20px rgba(0, 0, 0, 0.2),
            0 7px 10px rgba(0, 0, 0, 0.12);
        }
        .carousel:hover .preview-button-container {
          opacity: 1;
        }
        .carousel:hover .carousel-arrow {
          color: var(--boxel-200);
        }

        .preview-button {
          --boxel-button-font: 600 var(--boxel-font-sm);
          --boxel-button-padding: var(--boxel-sp-xs) var(--boxel-sp-lg);
          --boxel-button-border: 1px solid var(--boxel-light);
          --boxel-button-color: var(--boxel-purple);
          --boxel-button-text-color: var(--boxel-100);
          box-shadow:
            0 15px 20px rgba(0, 0, 0, 0.12),
            0 5px 10px rgba(0, 0, 0, 0.1);
          pointer-events: auto;
        }
        .preview-button:hover {
          --boxel-button-text-color: var(--boxel-light);
          box-shadow:
            0 15px 25px rgba(0, 0, 0, 0.2),
            0 7px 15px rgba(0, 0, 0, 0.15);
        }

        @container (max-height: 100px) {
          .carousel-nav,
          .preview-button-container,
          .carousel-dots {
            display: none;
          }
          .carousel-item {
            padding: var(--boxel-sp-4xs);
          }
          .carousel-item img,
          .carousel:hover .carousel-item img {
            box-shadow: none;
            border-radius: var(--boxel-border-radius-xs);
          }
        }
      }
    </style>
  </template>
}

export class ListingFittedTemplate extends Component<typeof Listing> {
  get firstImage() {
    return this.args.model.images?.[0];
  }

  get publisherInfo() {
    const hasPublisher = Boolean(this.args.model.publisher?.name);
    return hasPublisher ? 'By ' + this.args.model.publisher?.name : '';
  }

  get hasTags() {
    return this.args.model.tags && this.args.model.tags.length > 0;
  }

  get firstTagName() {
    return this.args.model.tags?.[0]?.name;
  }

  @action remix(e: MouseEvent) {
    e.stopPropagation();
    console.log('remix');
  }

  <template>
    <div class='fitted-template'>
      <div class='display-section'>
        {{#if @model.images}}
          <CarouselComponent
            @context={{@context}}
            @items={{@model.images}}
            @examples={{@model.examples}}
          />
        {{else}}
          <@model.constructor.icon
            data-test-card-type-icon
            class='card-type-icon'
          />
        {{/if}}
      </div>
      <div class='info-section'>
        <div class='card-content'>
          <h3 class='card-title' data-test-card-title>{{@model.name}}</h3>
          <h4 class='card-display-name' data-test-card-display-name>
            {{this.publisherInfo}}
          </h4>
        </div>
        <div class='card-tags-action'>
          {{#if this.hasTags}}
            <span class='card-tags'># {{this.firstTagName}}</span>
          {{/if}}
          <BoxelButton
            @kind='primary'
            @size='extra-small'
            class='card-remix-button'
            {{on 'click' this.remix}}
          >
            Remix
          </BoxelButton>
        </div>
      </div>
    </div>

    {{! template-lint-disable no-whitespace-for-layout  }}
    {{! ignore the above error because ember-template-lint complains about the whitespace in the multi-line comment below }}
    <style scoped>
      @layer {
        .fitted-template {
          width: 100%;
          height: 100%;
          display: flex;
          overflow: hidden;
        }
        .display-section {
          flex-shrink: 0;
          display: flex;
          justify-content: center;
          align-items: center;
          overflow: hidden;
          background-color: var(--boxel-200);
        }
        .card-type-icon {
          aspect-ratio: 1 / 1;
          width: 52px;
          height: 52px;
          max-width: 100%;
          max-height: 100%;
        }
        .info-section {
          display: flex;
          gap: var(--boxel-sp-sm);
          width: 100%;
          overflow: hidden;
          text-align: left;
          padding: var(--boxel-sp-xs) var(--boxel-sp);
        }
        .card-tags-action {
          display: flex;
          align-items: end;
          flex-direction: column;
          gap: var(--boxel-sp-sm);
        }
        .card-title {
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
          overflow: hidden;
          margin-block: 0;
          font: 600 var(--boxel-font-sm);
          letter-spacing: var(--boxel-lsp-sm);
          line-height: 1.25;
          text-overflow: ellipsis;
        }
        .card-display-name {
          margin-top: var(--boxel-sp-4xs);
          margin-bottom: 0;
          color: var(--boxel-450);
          font: 500 var(--boxel-font-xs);
          letter-spacing: var(--boxel-lsp-xs);
          text-overflow: ellipsis;
          white-space: nowrap;
          overflow: hidden;
        }
        .card-tags {
          color: var(--boxel-400);
          font: 500 var(--boxel-font-xs);
          letter-spacing: var(--boxel-lsp-xs);
          text-overflow: ellipsis;
          white-space: nowrap;
          flex: 1 1 auto;
          overflow: hidden;
        }
        .card-remix-button {
          --boxel-button-font: 600 var(--boxel-font-sm);
          margin-left: auto;
          flex: 0 0 auto;
        }
      }

      /* Aspect Ratio <= 1.0 (Vertical) */
      @container fitted-card (aspect-ratio <= 1.0) {
        .fitted-template {
          flex-direction: column;
        }
        .display-section {
          width: 100%;
          height: 70cqmax;
        }
        .info-section {
          flex-direction: column;
          justify-content: space-between;
          height: 100%;
          padding: var(--boxel-sp-xs);
        }
        .card-tags-action {
          flex-direction: row;
          justify-content: space-between;
        }
        .card-remix-button {
          --boxel-button-padding: var(--boxel-sp-4xs) var(--boxel-sp);
        }
      }

      @container fitted-card (aspect-ratio <= 1.0) and (height <= 118px) {
        .display-section {
          display: none;
        }
      }
      /* Vertical Tiles*/
      /* Small Tile (150 x 170) */
      @container fitted-card (aspect-ratio <= 1.0) and (150px <= width ) and (170px <= height) {
        .card-title {
          font-size: var(--boxel-font-size);
          -webkit-line-clamp: 3;
        }
      }
      /* CardsGrid Tile (170 x 250) */
      @container fitted-card (aspect-ratio <= 1.0) and (150px < width < 250px ) and (170px < height < 275px) {
        .display-section {
          aspect-ratio: 1 / 1;
        }
        .card-title {
          -webkit-line-clamp: 2;
        }
        .card-display-name,
        .card-tags {
          display: none;
        }
      }
      /* Tall Tile (150 x 275) */
      @container fitted-card (aspect-ratio <= 1.0) and (150px <= width ) and (275px <= height) {
        .card-title {
          font-size: var(--boxel-font-size);
          -webkit-line-clamp: 4;
        }
      }
      /* Large Tile (250 x 275) */
      @container fitted-card (aspect-ratio <= 1.0) and (250px <= width ) and (275px <= height) {
        .card-title {
          -webkit-line-clamp: 3;
        }
      }
      /* Vertical Cards */
      @container fitted-card (aspect-ratio <= 1.0) and (400px <= width) {
        .card-title {
          font-size: var(--boxel-font-size-med);
          -webkit-line-clamp: 4;
        }
      }

      /* Expanded Card (400 x 445) */
      /* 1.0 < Aspect Ratio (Horizontal) */
      @container fitted-card (1.0 < aspect-ratio) {
        .display-section {
          aspect-ratio: 1;
          max-width: 44%;
        }
        .info-section {
          flex-direction: column;
          justify-content: space-between;
        }
        .card-tags-action {
          flex-direction: row;
          justify-content: space-between;
        }
        .card-tags {
          display: none;
        }
      }
      @container fitted-card (1.0 < aspect-ratio) and (height <= 65px) {
        .info-section {
          align-self: center;
        }
      }
      /* Badges */
      @container fitted-card (1.0 < aspect-ratio) and (width < 250px) {
        .display-section {
          display: none;
        }
      }
      /* Small Badge (150 x 40) */
      @container fitted-card (1.0 < aspect-ratio) and (width < 250px) and (height < 65px) {
        .card-title {
          -webkit-line-clamp: 1;
          font: 600 var(--boxel-font-xs);
        }
        .card-display-name {
          margin-top: 0;
        }
      }
      /* Medium Badge (150 x 65) */

      /* Large Badge (150 x 105) */
      @container fitted-card (1.0 < aspect-ratio) and (width < 250px) and (105px <= height) {
        .card-title {
          -webkit-line-clamp: 3;
        }
      }

      /* Strips */
      /* Single Strip (250 x 40) */
      @container fitted-card (1.0 < aspect-ratio) and (250px <= width) and (height < 65px) {
        .fitted-template {
          padding: var(--boxel-sp-xxxs);
        }
        .card-display-name {
          display: none;
        }
      }

      /* Horizontal Tiles */
      /* Regular Tile (250 x 170) */
      @container fitted-card (1.0 < aspect-ratio) and (250px <= width < 400px) and (170px <= height) {
        .card-title {
          -webkit-line-clamp: 4;
          font-size: var(--boxel-font-size);
        }
      }

      /* Horizontal Cards */
      /* Compact Card  */
      @container fitted-card (1.0 < aspect-ratio) and (400px <= width) and (170px <= height) {
        .display-section {
          height: 100%;
        }
        .card-title {
          -webkit-line-clamp: 4;
          font-size: var(--boxel-font-size);
        }

        @container fitted-card (height <= 65px) {
          .card-title {
            -webkit-line-clamp: 1;
            font-size: var(--boxel-font-size);
          }
        }
      }

      /* Full Card (400 x 275) */
      @container fitted-card (1.0 < aspect-ratio) and (400px <= width) and (275px <= height) {
        .card-title {
          font-size: var(--boxel-font-size-med);
        }
        .info-section {
          padding: var(--boxel-sp);
        }
      }

      /* Control Card which is Smaller than */
      @container fitted-card (aspect-ratio <= 1.0) and (width <= 275px) {
        .card-tags {
          display: none;
        }
      }

      @container fitted-card (aspect-ratio <= 1.0) and (height <= 275px) {
        .card-title {
          -webkit-line-clamp: 1;
        }
        .card-display-name {
          display: none;
        }
      }

      /* Control linked to many component fitted size */
      @container fitted-card (height <= 65px) {
        .display-section {
          padding: var(--boxel-sp-xs);
        }
        .card-tags-action {
          display: none;
        }
      }
    </style>
  </template>
}
