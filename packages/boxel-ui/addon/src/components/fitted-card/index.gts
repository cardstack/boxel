import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { element } from '../../helpers.ts';

/**
 * FittedCard — generic responsive card layout for the fitted format.
 *
 * Named blocks:
 *   placeholder  – icon/content shown in the image column when no @imageUrl
 *   background   - block for additional background graphics
 *   badgeLeft    – absolutely-positioned badge anchored to the top-left corner
 *   badgeRight   – absolutely-positioned badge anchored to the top-right corner
 *   badge        – alias for badgeLeft (legacy; prefer badgeLeft/badgeRight)
 *   badgeRow     – inline flex row of badges/pills rendered above the header
 *   eyebrow      – tiny uppercase overline above the title
 *   image        – custom image block (caller owns accessibility; provide alt text
 *                  on the img element inside this block)
 *   title        – primary heading (required)
 *   subtitle     – secondary line below the title
 *   meta         – meta section for additional content between header and footer
 *   footer       – bottom row: date, location, price, stats, etc.
 *
 * Args:
 *   @imageUrl      – cover image URL (optional)
 *   @imageAlt      – alt text for the cover image (optional, defaults to "")
 *   @imageLoading  – loading attribute for the cover image: 'lazy' | 'eager'
 *                    (optional; omit to use the browser default)
 *   @titleTag      – HTML element tag for the title heading (default: 'h1').
 *                    Pass 'h2' or 'h3' when cards appear in a list to preserve
 *                    correct heading hierarchy for screen readers.
 *
 * CSS custom properties (set on the host element or a wrapper):
 *   --fc-content-padding      padding inside the text column
 *   --fc-content-gap          gap between content sections (with image)
 *   --fc-content-gap-no-image gap between content sections (no image)
 *   --fc-content-justify      justify-content for the text column (default: flex-start; no-image: space-between)
 *   --fc-header-gap           gap between eyebrow / title / subtitle
 *   --fc-eyebrow-font-size
 *   --fc-eyebrow-line-height
 *   --fc-title-font-size
 *   --fc-title-line-height
 *   --fc-title-line-clamp     -webkit-line-clamp value
 *   --fc-subtitle-font-size
 *   --fc-subtitle-line-height
 *   --fc-subtitle-line-clamp
 *   --fc-title-text-overflow
 *   --fc-title-white-space
 *   --fc-subtitle-text-overflow
 *   --fc-subtitle-white-space
 *   --fc-image-width          image column width (default 40cqh)
 *   --fc-image-min-width      image column min-width (default 3.75rem)
 *   --fc-image-max-width      image column max-width (default 12.5rem)
 *   --fc-image-height         image column height (default auto)
 *   --fc-image-object-fit     object-fit for the cover image (default: cover)
 *   --fc-image-background     image column background when no <img> fills it
 *                             (default: linear-gradient(180deg, var(--muted), var(--accent)))
 *   --fc-image-fade-color     base color for the expanded-card image fade gradient
 *                             (default: var(--card)); set to match a custom card background
 *   --fc-badge-offset         inset from card edges for absolutely-positioned badges
 *                             (default: var(--boxel-sp-2xs))
 *   --fc-badge-row-gap        gap inside the badge row
 *   --fc-badge-row-justify    justify-content for the badge row
 *   --fc-meta-font-size
 *   --fc-meta-line-height
 *   --fc-meta-flex-wrap
 *   --fc-meta-gap
 *   --fc-meta-justify
 *   --fc-meta-align-items     align-items for the meta row (default: center)
 *   --fc-footer-font-size
 *   --fc-footer-gap
 *   --fc-footer-justify       justify-content for the footer row
 *   --fc-footer-align-items   align-items for the footer row (default: center)
 *   --fc-footer-flex-wrap     flex-wrap for the footer row (default: nowrap)
 *
 * Section visibility (override to force-show or force-hide a section regardless of breakpoint):
 *   Note: badgeLeft/Right are always position:absolute relative to the card —
 *   set --fc-badge-right/left-display: none to hide them; block to force-show.
 *   --fc-image-display           display value for the image column (default: flex)
 *   --fc-badge-left-display      display value for absolute left badge (default: block)
 *   --fc-badge-right-display     display value for absolute right badge (default: block)
 *   --fc-badge-row-display       display value for the badge row (default: flex)
 *   --fc-subtitle-display        display value for the subtitle (default: -webkit-box)
 *   --fc-meta-display            display value for the meta row (default: flex)
 *   --fc-footer-display          display value for the footer row (default: flex)
 *
 *   Set to `none` to hide, or to the default value above to force-show at any size.
 *   Example — always show the footer:
 *     .my-card { --fc-footer-display: flex; }
 *   Example — hide meta at a custom breakpoint:
 *     @container fitted-card (width < 300px) { .my-card { --fc-meta-display: none; } }
 *
 * Usage example:
 *
 *   <FittedCard @imageUrl={{@model.imageUrl}} @imageAlt={{@model.title}}>
 *     <:background><div class='test-bg'></div></:background>
 *     <:placeholder><BookOpen width='24' height='24' /></:placeholder>
 *     <:badgeLeft><Pill @size='extra-small'>New</Pill></:badgeLeft>
 *     <:badgeRight><Pill @size='extra-small'>Draft</Pill></:badgeRight>
 *     <:eyebrow>Non-fiction</:eyebrow>
 *     <:title><@fields.cardTitle /></:title>
 *     <:subtitle><@fields.cardDescription /></:subtitle>
 *     <:meta><span>150 mins</span><span>Difficulty 5</span></:meta>
 *     <:footer>
 *       <span>320 pages</span>
 *       <span>2024</span>
 *     </:footer>
 *   </FittedCard>
 *
 * Footer dividers: style separators from the calling card's own scoped CSS since
 * footer content is in the caller's scope, not this component's.
 */

interface FittedCardSignature {
  Args: {
    imageAlt?: string;
    imageLoading?: 'lazy' | 'eager';
    imageUrl?: string | null;
    titleTag?: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
  };
  Blocks: {
    background: [];
    badge: [];
    badgeLeft: [];
    badgeRight: [];
    badgeRow: [];
    eyebrow: [];
    footer: [];
    image: [];
    meta: [];
    placeholder: [];
    subtitle: [];
    title: [];
  };
  Element: HTMLElement;
}

export const FittedCard: TemplateOnlyComponent<FittedCardSignature> = <template>
  <article class='fitted-card' ...attributes>

    {{#if (has-block 'background')}}
      <div class='fc-background'>{{yield to='background'}}</div>
    {{/if}}

    {{! ── Thumbnail ──────────────────────────────────────────────── }}
    {{#if @imageUrl}}
      <div class='fc-image'>
        <img
          src={{@imageUrl}}
          alt={{if @imageAlt @imageAlt ''}}
          loading={{@imageLoading}}
        />
      </div>
    {{else if (has-block 'image')}}
      <div class='fc-image'>
        {{yield to='image'}}
      </div>
    {{else if (has-block 'placeholder')}}
      <div class='fc-image'>
        <div class='fc-placeholder'>{{yield to='placeholder'}}</div>
      </div>
    {{/if}}

    {{! ── Absolute badges (always positioned relative to .fitted-card) ── }}
    {{#if (has-block 'badgeLeft')}}
      <div class='fc-badge fc-badge-left'>{{yield to='badgeLeft'}}</div>
    {{else if (has-block 'badge')}}
      <div class='fc-badge fc-badge-left'>{{yield to='badge'}}</div>
    {{/if}}

    {{#if (has-block 'badgeRight')}}
      <div class='fc-badge fc-badge-right'>{{yield to='badgeRight'}}</div>
    {{/if}}

    {{! ── Text content ──────────────────────────────────────────────────  }}
    <div class='fc-content'>
      {{#if (has-block 'badgeRow')}}
        <div class='fc-badge-row'>{{yield to='badgeRow'}}</div>
      {{/if}}

      <header class='fc-header'>
        {{#if (has-block 'eyebrow')}}
          <p class='fc-eyebrow boxel-ellipsize'>{{yield to='eyebrow'}}</p>
        {{/if}}
        {{#if @titleTag}}
          {{#let (element @titleTag) as |TitleTag|}}
            <TitleTag class='fc-title'>{{yield to='title'}}</TitleTag>
          {{/let}}
        {{else}}
          <h1 class='fc-title'>{{yield to='title'}}</h1>
        {{/if}}
        {{#if (has-block 'subtitle')}}
          <p class='fc-subtitle'>{{yield to='subtitle'}}</p>
        {{/if}}
      </header>

      {{#if (has-block 'meta')}}
        <div class='fc-meta'>{{yield to='meta'}}</div>
      {{/if}}

      {{#if (has-block 'footer')}}
        <footer class='fc-footer'>{{yield to='footer'}}</footer>
      {{/if}}
    </div>

  </article>

  <style scoped>
    @layer boxelComponentL1 {
      /* ── Base layout ── */
      .fitted-card {
        --fc-content-padding: var(--boxel-sp-xs);
        --fc-content-gap: var(--boxel-sp-3xs);
        --fc-header-gap: var(--boxel-sp-6xs);
        --fc-eyebrow-font-size: 0.625rem;
        --fc-eyebrow-line-height: 1.1;
        --fc-title-font-size: var(--boxel-font-size-sm);
        --fc-title-line-height: 1.2;
        --fc-title-line-clamp: 2;
        --fc-subtitle-font-size: var(--boxel-font-size-xs);
        --fc-subtitle-line-height: 1.1;
        --fc-subtitle-line-clamp: 2;
        --fc-image-width: 40cqh;
        --fc-image-min-width: 3.75rem;
        --fc-image-max-width: 12.5rem;
        --fc-image-height: auto;
        --fc-image-object-fit: cover;
        --fc-image-background: linear-gradient(
          180deg,
          var(--muted) 0%,
          var(--accent) 100%
        );
        --fc-image-fade-color: var(--card);
        --fc-badge-offset: var(--boxel-sp-2xs);
        --fc-content-gap-no-image: var(--boxel-sp-xs);
        --fc-badge-row-gap: var(--boxel-sp-2xs);
        --fc-badge-row-justify: space-between;
        --fc-meta-font-size: var(--boxel-caption-font-size);
        --fc-meta-line-height: 1.1;
        --fc-meta-flex-wrap: nowrap;
        --fc-meta-gap: var(--boxel-sp-2xs);
        --fc-meta-justify: flex-start;
        --fc-meta-align-items: center;
        --fc-footer-font-size: var(--boxel-caption-font-size);
        --fc-footer-gap: var(--boxel-sp-2xs);
        --fc-footer-justify: flex-start;
        --fc-footer-align-items: center;
        --fc-footer-flex-wrap: nowrap;
        --fc-content-justify: flex-start;
        --fc-title-text-overflow: clip;
        --fc-title-white-space: normal;
        --fc-subtitle-text-overflow: clip;
        --fc-subtitle-white-space: normal;
        --fc-image-display: flex;
        --fc-badge-right-display: block;
        --fc-badge-left-display: block;
        --fc-badge-row-display: flex;
        --fc-subtitle-display: -webkit-box;
        --fc-meta-display: flex;
        --fc-footer-display: flex;

        position: relative;
        display: grid;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: var(--card);
        color: var(--card-foreground);
      }
      .fitted-card:has(.fc-image) {
        grid-template-columns: auto 1fr;
      }

      .fc-background {
        position: absolute;
        inset: 0;
        pointer-events: none;
        overflow: hidden;
      }

      /* ── Image column ── */
      .fc-image {
        position: relative;
        width: var(--fc-image-width);
        min-width: var(--fc-image-min-width);
        max-width: var(--fc-image-max-width);
        height: var(--fc-image-height);
        overflow: hidden;
        background: var(--fc-image-background);
        display: var(--fc-image-display, flex);
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }
      .fc-image img {
        width: 100%;
        height: 100%;
        object-fit: var(--fc-image-object-fit);
        display: block;
      }
      .fc-placeholder {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: 100%;
      }

      /* ── Text Content ── */
      .fc-content {
        display: flex;
        flex-direction: column;
        padding: var(--fc-content-padding);
        gap: var(--fc-content-gap);
        justify-content: var(--fc-content-justify);
        overflow: hidden;
        max-width: 100%;
        min-width: 0;
      }
      .fitted-card:not(:has(.fc-image)) .fc-content {
        gap: var(--fc-content-gap-no-image, var(--boxel-sp-xs));
      }

      /* ── Header ── */
      .fc-header {
        display: flex;
        flex-direction: column;
        gap: var(--fc-header-gap);
        overflow: hidden;
        max-width: 100%;
        min-width: 0;
        flex-shrink: 0;
      }
      .fc-eyebrow {
        font-size: var(--fc-eyebrow-font-size);
        font-weight: var(--boxel-caption-font-weight);
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: var(--muted-foreground);
        margin: 0;
        line-height: var(--fc-eyebrow-line-height);
      }
      .fc-title {
        font-size: var(--fc-title-font-size);
        font-weight: var(--boxel-heading-font-weight);
        line-height: var(--fc-title-line-height);
        margin: 0;
        display: -webkit-box;
        -webkit-line-clamp: var(--fc-title-line-clamp);
        -webkit-box-orient: vertical;
        overflow: hidden;
        text-overflow: var(--fc-title-text-overflow);
        white-space: var(--fc-title-white-space);
        text-wrap: pretty;
      }
      .fc-subtitle {
        font-size: var(--fc-subtitle-font-size);
        color: var(--muted-foreground);
        line-height: var(--fc-subtitle-line-height);
        margin: 0;
        display: var(--fc-subtitle-display, -webkit-box);
        -webkit-line-clamp: var(--fc-subtitle-line-clamp);
        -webkit-box-orient: vertical;
        overflow: hidden;
        text-overflow: var(--fc-subtitle-text-overflow);
        white-space: var(--fc-subtitle-white-space);
        text-wrap: pretty;
      }

      /* ── Meta ── */
      .fc-meta {
        display: var(--fc-meta-display, flex);
        flex-wrap: var(--fc-meta-flex-wrap);
        align-items: var(--fc-meta-align-items);
        justify-content: var(--fc-meta-justify);
        gap: var(--fc-meta-gap);
        margin: 0;
        font-size: var(--fc-meta-font-size);
        line-height: var(--fc-meta-line-height);
        overflow: hidden;
      }

      /* ── Footer ── */
      .fc-footer {
        display: var(--fc-footer-display, flex);
        flex-wrap: var(--fc-footer-flex-wrap);
        align-items: var(--fc-footer-align-items);
        justify-content: var(--fc-footer-justify);
        gap: var(--fc-footer-gap);
        overflow: hidden;
        font-size: var(--fc-footer-font-size);
        margin-top: auto;
        max-width: 100%;
        min-width: 0;
        flex-shrink: 0;
      }

      /* Hide block containers when yielded content is empty.
         .fc-badge uses :not(:has(*)) rather than :empty because Glimmer emits
         whitespace text nodes around block helpers in named slots, which prevents
         :empty from matching even when no real content is rendered. */
      .fc-eyebrow:empty,
      .fc-background:empty,
      .fc-subtitle:empty,
      .fc-meta:empty,
      .fc-footer:empty,
      .fc-badge:not(:has(*)),
      .fc-badge-row:empty {
        display: none;
      }

      /* When <:placeholder> yields empty content, collapse the image column */
      .fitted-card:has(.fc-placeholder:empty) {
        grid-template-columns: 1fr;
      }
      .fc-image:has(> .fc-placeholder:empty) {
        display: none;
      }

      /* ── Badges (always absolutely positioned relative to .fitted-card) ── */
      .fc-badge {
        position: absolute;
        z-index: 1;
        top: var(--fc-badge-offset);
      }
      .fc-badge-left {
        left: var(--fc-badge-offset);
        display: var(--fc-badge-left-display);
      }
      .fc-badge-right {
        right: var(--fc-badge-offset);
        display: var(--fc-badge-right-display);
      }

      /* ── Badge Row (flex positioning, inside content flow) ── */
      .fc-badge-row {
        display: var(--fc-badge-row-display, flex);
        justify-content: var(--fc-badge-row-justify);
        gap: var(--fc-badge-row-gap);
      }

      /* ────────────────────────────────────────────────────────────────
           Container query breakpoints
           (runtime provides the "fitted-card" container)
           ──────────────────────────────────────────────────────────────── */

      /* Small Badge 150x40 */
      @container fitted-card (1.0 < aspect-ratio) and (width < 250px) and (height < 65px) {
        .fitted-card {
          --fc-content-padding: var(--boxel-sp-4xs);
          --fc-title-line-clamp: 1;
          --fc-image-display: none;
          --fc-badge-right-display: none;
          --fc-badge-left-display: none;
          --fc-badge-row-display: none;
          --fc-subtitle-display: none;
          --fc-meta-display: none;
          --fc-footer-display: none;
          --fc-content-justify: center;
          --fc-title-text-overflow: ellipsis;
          --fc-title-white-space: nowrap;
          grid-template-columns: 1fr;
        }
      }
      /* Medium Badge 150x65 */
      @container fitted-card (1.0 < aspect-ratio) and (width < 250px) and (65px <= height < 105px) {
        .fitted-card {
          --fc-title-line-clamp: 1;
          --fc-subtitle-line-clamp: 1;
          --fc-image-display: none;
          --fc-badge-right-display: none;
          --fc-badge-left-display: none;
          --fc-badge-row-display: none;
          --fc-meta-display: none;
          --fc-footer-display: none;
          --fc-content-justify: center;
          --fc-title-text-overflow: ellipsis;
          --fc-title-white-space: nowrap;
          --fc-subtitle-text-overflow: ellipsis;
          --fc-subtitle-white-space: nowrap;
          grid-template-columns: 1fr;
        }
      }
      /* Large Badge 150x105 */
      @container fitted-card (1.0 < aspect-ratio) and (width < 250px) and (height >= 105px) {
        .fitted-card {
          --fc-image-display: none;
          --fc-badge-right-display: none;
          --fc-badge-left-display: none;
          --fc-badge-row-display: none;
          --fc-meta-display: none;
          --fc-content-justify: center;
          grid-template-columns: 1fr;
        }
      }

      /* Single Strip 250x40 */
      @container fitted-card (1.0 < aspect-ratio) and (250px <= width) and (height < 65px) {
        .fitted-card {
          --fc-content-padding: var(--boxel-sp-4xs);
          --fc-title-line-clamp: 1;
          --fc-badge-right-display: none;
          --fc-badge-left-display: none;
          --fc-badge-row-display: none;
          --fc-subtitle-display: none;
          --fc-meta-display: none;
          --fc-footer-display: none;
          --fc-content-justify: center;
          --fc-title-text-overflow: ellipsis;
          --fc-title-white-space: nowrap;
        }
      }
      /* Double Strip 250x65 */
      @container fitted-card (1.0 < aspect-ratio) and (250px <= width < 400px) and (65px <= height < 105px) {
        .fitted-card {
          --fc-title-line-clamp: 1;
          --fc-subtitle-line-clamp: 1;
          --fc-badge-right-display: none;
          --fc-badge-left-display: none;
          --fc-badge-row-display: none;
          --fc-meta-display: none;
          --fc-footer-display: none;
          --fc-content-justify: center;
          --fc-title-text-overflow: ellipsis;
          --fc-title-white-space: nowrap;
          --fc-subtitle-text-overflow: ellipsis;
          --fc-subtitle-white-space: nowrap;
        }
      }
      /* Triple Strip 250x105 */
      @container fitted-card (1.0 < aspect-ratio) and (250px <= width < 400px) and (105px <= height < 170px) {
        .fitted-card {
          --fc-badge-right-display: none;
          --fc-badge-left-display: none;
          --fc-badge-row-display: none;
          --fc-meta-display: none;
          --fc-footer-display: none;
        }
      }
      /* Double Wide Strip 400x65 */
      @container fitted-card (1.0 < aspect-ratio) and (400px <= width) and (65px <= height < 105px) {
        .fitted-card {
          --fc-image-width: 40cqw;
          --fc-title-line-clamp: 1;
          --fc-subtitle-line-clamp: 1;
          --fc-badge-right-display: none;
          --fc-badge-left-display: none;
          --fc-badge-row-display: none;
          --fc-meta-display: none;
          --fc-footer-display: none;
          --fc-content-justify: center;
          --fc-title-text-overflow: ellipsis;
          --fc-title-white-space: nowrap;
          --fc-subtitle-text-overflow: ellipsis;
          --fc-subtitle-white-space: nowrap;
        }
        :has(.fc-image) {
          --fc-badge-left-display: block;
        }
      }
      /* Triple Wide Strip 400x105 */
      @container fitted-card (1.0 < aspect-ratio) and (400px <= width) and (105px <= height < 170px) {
        .fitted-card {
          --fc-image-width: 40cqw;
          --fc-badge-right-display: none;
          --fc-badge-left-display: none;
          --fc-badge-row-display: none;
          --fc-meta-display: none;
          --fc-footer-display: none;
        }
        :has(.fc-image) {
          --fc-badge-left-display: block;
        }
      }

      /* ── Vertical & square tiles ── */
      @container fitted-card (aspect-ratio <= 1.0) {
        .fitted-card {
          --fc-image-width: 100%;
          --fc-image-max-width: 100%;
          --fc-image-height: 45cqmin;
          grid-template-columns: 1fr;
        }
        .fitted-card:has(.fc-image) {
          grid-template-columns: 1fr;
          grid-template-rows: auto 1fr;
        }
      }
      /* Vertical & square, taller than 250px */
      @container fitted-card (aspect-ratio <= 1.0) and (250px <= height) {
        .fitted-card {
          --fc-image-height: 55cqmin;
        }
      }
      /* Small Tile and smaller (150x170) */
      @container fitted-card (aspect-ratio <= 1.0) and (width <= 150px) and (height <= 170px) {
        .fitted-card {
          --fc-title-font-size: var(--boxel-font-size-xs);
          --fc-badge-row-display: none;
          --fc-meta-display: none;
        }
        :not(:has(.fc-image)) {
          --fc-badge-right-display: none;
          --fc-badge-left-display: none;
        }
      }
      /* Vertical, shorter than small-tile */
      @container fitted-card (aspect-ratio <= 1.0) and (height < 170px) {
        .fitted-card {
          --fc-subtitle-line-clamp: 1;
          --fc-meta-display: none;
          --fc-footer-display: none;
          --fc-subtitle-text-overflow: ellipsis;
          --fc-subtitle-white-space: nowrap;
        }
      }
      /* Vertical, narrower than 140px; hide badge */
      @container fitted-card (aspect-ratio <= 1.0) and (width < 140px) {
        .fitted-card {
          --fc-badge-right-display: none;
          --fc-badge-left-display: none;
        }
      }
      /* Regular Tile 250x170 */
      @container fitted-card (1.0 < aspect-ratio) and (250px <= width < 400px) and (170px <= height) {
        .fitted-card:not(:has(.fc-image)) {
          --fc-badge-right-display: none;
          --fc-badge-left-display: none;
        }
      }
      /* CardsGrid Tile ~170x250 */
      @container fitted-card (aspect-ratio <= 1.0) and (155px <= width <= 185px) and (height >= 200px) {
        .fitted-card {
          --fc-meta-display: none;
        }
        .fitted-card:not(:has(.fc-image)) {
          --fc-badge-right-display: none;
          --fc-badge-left-display: none;
        }
      }
      /* Tall Tile ~150x275 */
      @container fitted-card (aspect-ratio <= 1.0) and (150px <= width < 250px) and (height >= 250px) {
        .fitted-card:not(:has(.fc-image)) {
          --fc-badge-right-display: none;
          --fc-badge-left-display: none;
        }
      }
      /* Large Tile ~250x275 */
      @container fitted-card (aspect-ratio <= 1.0) and (250px <= width < 400px) and (height >= 250px) {
        .fitted-card:not(:has(.fc-image)) {
          --fc-badge-right-display: none;
          --fc-badge-left-display: none;
        }
      }

      /* Compact Card (400x170) */
      @container fitted-card (1.0 < aspect-ratio) and (width >= 400px) and (170px <= height < 275px) {
        .fitted-card {
          --fc-content-padding: var(--boxel-sp-xs);
          --fc-content-gap: var(--boxel-sp-2xs);
          --fc-header-gap: var(--boxel-sp-3xs);
          --fc-image-width: 40cqw;
          --fc-content-justify: space-between;
        }
        .fitted-card:not(:has(.fc-image)) {
          --fc-badge-right-display: none;
          --fc-badge-left-display: none;
        }
      }
      /* Full Card (400x275) */
      @container fitted-card (1.0 < aspect-ratio) and (width >= 400px) and (275px <= height < 445px) {
        .fitted-card {
          --fc-content-padding: var(--boxel-sp-xs);
          --fc-content-gap: var(--boxel-sp-xs);
          --fc-header-gap: var(--boxel-sp-2xs);
          --fc-image-width: 40cqw;
          --fc-title-font-size: var(--boxel-font-size);
          --fc-title-line-clamp: 3;
          --fc-subtitle-font-size: var(--boxel-font-size-sm);
          --fc-subtitle-line-clamp: 3;
          --fc-content-justify: space-between;
        }
        .fitted-card:not(:has(.fc-image)) {
          --fc-badge-right-display: none;
          --fc-badge-left-display: none;
        }
      }
      /* No-image layout: extra padding increase beyond what card breakpoints set */
      @container fitted-card (width >= 400px) and (170px <= height < 275px) {
        .fitted-card:not(:has(.fc-image)) {
          --fc-content-padding: var(--boxel-sp-sm);
        }
      }
      @container fitted-card (width >= 400px) and (height >= 275px) {
        .fitted-card:not(:has(.fc-image)) {
          --fc-content-padding: var(--boxel-sp);
        }
      }
      @container fitted-card (aspect-ratio <= 1.0) and (height >= 250px) {
        .fitted-card:not(:has(.fc-image)) {
          --fc-header-gap: var(--boxel-sp-3xs);
          --fc-content-padding: var(--boxel-sp-sm);
          --fc-content-justify: space-between;
        }
      }

      /* Expanded Card (400x445) */
      @container fitted-card (aspect-ratio <= 1.0) and (width >= 400px) and (445px <= height) {
        .fitted-card {
          --fc-content-padding: var(--boxel-sp);
          --fc-content-gap: var(--boxel-sp);
          --fc-image-height: 50cqh;
          --fc-eyebrow-line-height: 1.2;
          --fc-title-font-size: var(--boxel-font-size);
          --fc-title-line-height: 1.3;
          --fc-title-line-clamp: 3;
          --fc-subtitle-font-size: var(--boxel-font-size-sm);
          --fc-subtitle-line-clamp: 3;
        }
        .fitted-card:not(:has(.fc-image)) {
          --fc-badge-right-display: none;
          --fc-badge-left-display: none;
        }
        .fc-image {
          position: relative;
        }
        /* Fade image into card background */
        .fc-image::after {
          content: '';
          position: absolute;
          inset: auto 0 0;
          height: 35%;
          background: linear-gradient(
            to bottom,
            transparent,
            var(--fc-image-fade-color)
          );
          pointer-events: none;
        }
        .fc-footer {
          gap: var(--boxel-sp-sm);
        }
      }
    }
  </style>
</template>;

export default FittedCard;
