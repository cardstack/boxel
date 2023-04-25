import Component from '@glimmer/component';
import { array, concat, hash } from '@ember/helper';
import LoadingIndicator from '../loading-indicator';
import cn from '../../helpers/cn';
import { or, eq, not } from '../../helpers/truth-helpers';
import { LinkTo } from '@ember/routing';
import './style.css';

interface Signature {
  Element: HTMLButtonElement | HTMLAnchorElement;
  Args: {
    as?: string;
    kind?: string;
    disabled?: boolean;
    loading?: boolean;
    route?: any;
    models?: any;
    query?: any;
    size?: string;
    href?: string;
    class?: string;
    tooltip?: string;
  };
  Blocks: {
    default: [];
  };
}
export default class ButtonComponent extends Component<Signature> {
  defaultSize = 'base';
  defaultKind = 'secondary-light';

  <template>
    {{#let
      (cn
        'boxel-button'
        @class
        (concat 'boxel-button--size-' (if @size @size this.defaultSize))
        (concat 'boxel-button--kind-' (if @kind @kind this.defaultKind))
        (if @tooltip 'boxel-button--with-tooltip')
      )
      as |classes|
    }}
      {{#if (or (not @as) (eq @as 'button'))}}
        <button
          class={{cn classes (if @loading 'boxel-button--loading')}}
          tabindex={{if @loading -1 0}}
          disabled={{@disabled}}
          data-hover={{@tooltip}}
          data-test-boxel-button
          ...attributes
        >
          {{#if @loading}}
            <LoadingIndicator
              class='boxel-button__loading-indicator'
              @color='var(--boxel-button-text-color)'
              data-test-boxel-button-loading-indicator
            />
          {{/if}}
          {{yield}}
        </button>
      {{else if (eq @as 'anchor')}}
        <a
          class={{classes}}
          href={{unless @disabled @href}}
          data-test-boxel-button
          data-hover={{@tooltip}}
          ...attributes
        >
          {{yield}}
        </a>
      {{else if (eq @as 'link-to')}}
        <LinkTo
          class={{classes}}
          @route={{@route}}
          @models={{if @models @models (array)}}
          @query={{if @query @query (hash)}}
          @disabled={{@disabled}}
          data-test-boxel-button
          tabindex={{if @disabled -1 0}}
          data-hover={{@tooltip}}
          ...attributes
        >
          {{yield}}
        </LinkTo>
      {{/if}}
    {{/let}}
  </template>
}
