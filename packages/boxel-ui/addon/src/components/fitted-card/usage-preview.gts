import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { type FittedFormatSpec, cn, gt, gte } from '../../helpers.gts';
import CopyButton from '../copy-button/index.gts';

export type Spec = Partial<FittedFormatSpec> & {
  height: number;
  width: number;
};

export const calcRatio = ({ width, height }: Spec) =>
  (width / height).toFixed(2);

const QUERIES: Record<string, string> = {
  'small-badge': '(1.0 < aspect-ratio) and (width < 250px) and (height < 65px)',
  'medium-badge':
    '(1.0 < aspect-ratio) and (width < 250px) and (65px <= height < 105px)',
  'large-badge':
    '(1.0 < aspect-ratio) and (width < 250px) and (height >= 105px)',
  'single-strip':
    '(1.0 < aspect-ratio) and (250px <= width) and (height < 65px)',
  'double-strip':
    '(1.0 < aspect-ratio) and (250px <= width < 400px) and (65px <= height < 105px)',
  'triple-strip':
    '(1.0 < aspect-ratio) and (250px <= width < 400px) and (105px <= height < 170px)',
  'double-wide-strip':
    '(1.0 < aspect-ratio) and (400px <= width) and (65px <= height < 105px)',
  'triple-wide-strip':
    '(1.0 < aspect-ratio) and (400px <= width) and (105px <= height < 170px)',
  'small-tile':
    '(aspect-ratio <= 1.0) and (width <= 150px) and (height <= 170px)',
  'regular-tile':
    '(1.0 < aspect-ratio) and (250px <= width < 400px) and (170px <= height)',
  'cardsgrid-tile':
    '(aspect-ratio <= 1.0) and (155px <= width <= 185px) and (height >= 200px)',
  'tall-tile':
    '(aspect-ratio <= 1.0) and (150px <= width < 250px) and (250px <= height)',
  'large-tile':
    '(aspect-ratio <= 1.0) and (250px <= width < 400px) and (250px <= height)',
  'compact-card':
    '(1.0 < aspect-ratio) and (width >= 400px) and (170px <= height < 275px)',
  'full-card':
    '(1.0 < aspect-ratio) and (width >= 400px) and (275px <= height < 445px)',
  'expanded-card':
    '(aspect-ratio <= 1.0) and (width >= 400px) and (445px <= height)',
};

const containerQuery = (spec: Spec) => {
  const conditions =
    spec.id && QUERIES[spec.id]
      ? QUERIES[spec.id]
      : `(${spec.width}px <= width) and (${spec.height}px <= height)`;
  return `@container fitted-card ${conditions} { }`;
};

interface FittedItemContainerSignature {
  Args: { spec: Spec };
  Blocks: { default: [] };
}

export const FittedItemContainer: TemplateOnlyComponent<FittedItemContainerSignature> =
  <template>
    <div
      class={{cn
        'item'
        wide=(gt @spec.width 300)
        full-width=(gte @spec.width 400)
      }}
    >
      <div class='desc'>
        <h4>{{@spec.title}} {{@spec.width}}px &times; {{@spec.height}}px</h4>
        Aspect Ratio
        {{calcRatio @spec}}
        <CopyButton
          @textToCopy={{containerQuery @spec}}
          @tooltipText='Copy @container query'
          @size='extra-small'
          @variant='secondary'
          class='copy-btn'
        />
      </div>
      {{yield}}
    </div>
    <style scoped>
      .item {
        position: relative;
        padding-top: 50px;
        padding-inline: var(--boxel-sp);
        padding-bottom: var(--boxel-sp);
        background-color: color-mix(
          in oklab,
          var(--background, var(--boxel-light)) 90%,
          var(--foreground, var(--boxel-dark))
        );
      }
      .wide {
        grid-column: span 2;
      }
      .full-width {
        grid-column: -1 / 1;
      }
      .desc {
        position: absolute;
        top: 0;
        right: 0;
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-4xs);
        padding: var(--boxel-sp-4xs);
        background-color: var(--boxel-light);
        border-left: var(--boxel-border-card);
        border-right: var(--boxel-border-card);
        border-bottom: var(--boxel-border-card);
        color: var(--muted-foreground, var(--boxel-450));
        font: var(--boxel-font-xs);
      }
      h4 {
        margin: 0;
        font-weight: 500;
      }
      .copy-btn {
        margin-left: auto;
        flex-shrink: 0;
      }
    </style>
  </template>;

interface FittedUsagePreviewSignature {
  Args: { specs: { items: Spec[]; title: string }[] };
  Blocks: { default: [spec: Spec] };
}

export const FittedUsagePreview: TemplateOnlyComponent<FittedUsagePreviewSignature> =
  <template>
    <div class='scroller' tabindex='0'>
      {{#each @specs as |specGroup|}}
        <h3>{{specGroup.title}}</h3>
        {{#each specGroup.items as |spec|}}
          <FittedItemContainer @spec={{spec}}>
            {{yield spec}}
          </FittedItemContainer>
        {{/each}}
      {{/each}}
    </div>
    <style scoped>
      .scroller {
        max-height: 40vh;
        overflow-y: scroll;
        border: 1px solid var(--border, var(--boxel-200));
        padding: 10px;
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
        gap: var(--boxel-sp-xs);
      }
      h3 {
        grid-column: -1 / 1;
        font-weight: 500;
      }
    </style>
  </template>;
