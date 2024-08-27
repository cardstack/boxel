import { concat } from '@ember/helper';
import Component from '@glimmer/component';

import cn from '../../helpers/cn.ts';

export type BoxelBadgeVariant =
  | 'default'
  | 'secondary'
  | 'destructive'
  | 'outline';

interface Signature {
  Args: {
    variant: BoxelBadgeVariant;
  };
  Blocks: {
    default: [];
  };
  Element: HTMLButtonElement | HTMLAnchorElement;
}
export default class Badge extends Component<Signature> {
  defaultVariant: BoxelBadgeVariant = 'default';

  <template>
    {{#let
      (cn
        'boxel-badge'
        (concat 'variant-' (if @variant @variant this.defaultVariant))
      )
      as |classes|
    }}
      <span class={{classes}}>
        Badge
      </span>
    {{/let}}

    <style>
      .boxel-badge {
        display: inline-flex;
        align-items: center;
        border-radius: 100px;
        border: 1px solid transparent;
        padding: var(--boxel-sp-5xs) var(--boxel-sp-sm); /* Adjusted padding using Boxel spacing variables */
        font-size: var(--boxel-font-xs);
        font-weight: 500;
        transition: background-color 0.2s;
        background-color: transparent;
        color: var(--boxel-light);
        outline: none;
      }

      .boxel-badge:focus {
        outline: none;
        box-shadow:
          0 0 0 2px var(--boxel-light-400),
          0 0 0 4px var(--boxel-outline-color);
      }

      .boxel-badge:hover {
        opacity: 0.8;
      }

      .variant-default {
        border-color: transparent;
        background-color: var(--boxel-highlight);
        color: var(--boxel-light);
      }

      .variant-secondary {
        border-color: transparent;
        background-color: var(--boxel-dark);
        color: var(--boxel-light);
      }

      .variant-destructive {
        border-color: transparent;
        background-color: var(--boxel-danger);
        color: var(--boxel-light);
      }

      .variant-outline {
        border: 1px solid;
        border-color: var(--boxel-300);
        color: var(--boxel-dark);
      }
    </style>
  </template>
}
