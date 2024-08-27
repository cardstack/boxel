import Component from '@glimmer/component';
import type { ComponentLike } from '@glint/template';
import { Signature as BoxelButtonSignature } from '../button/index.gts';
import { BoxelButton } from '@cardstack/boxel-ui/components';
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { eq } from '@cardstack/boxel-ui/helpers';
import { CaretRight, Slash } from '@cardstack/boxel-ui/icons';

interface Signature {
  Args: {};
  Blocks: {
    default: [ComponentLike<BoxelButtonSignature>];
  };
  Element: HTMLDivElement;
}

export default class Breadcrumb extends Component<Signature> {
  <template>
    <div class='breadcrumb-list' data-test-breadcrumb-list>
      {{yield (component BreadcrumbItem)}}
    </div>
    <style>
      .breadcrumb-list {
        --boxel-button-border-color: transparent;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        list-style: none;
      }
    </style>
  </template>
}

const BreadcrumbItem = BoxelButton;

type SeparatorVariant = 'caretRight' | 'slash';

interface SeparatorSignature {
  Args: {
    variant: SeparatorVariant;
  };
  Blocks: {
    default: [];
  };
  Element: HTMLDivElement;
}

export const BreadcrumbSeparator: TemplateOnlyComponent<SeparatorSignature> =
  <template>
    <div class='breadcrumb-separator'>
      {{#if (eq @variant 'caretRight')}}
        <CaretRight role='presentation' />
      {{else if (eq @variant 'slash')}}
        <Slash role='presentation' />
      {{/if}}
    </div>
    <style>
      .breadcrumb-separator {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
      }
      .breadcrumb-separator svg {
        width: 100%;
        height: 100%;
        max-height: 2em; /* Limits the height to the line height of the text */
      }
    </style>
  </template>;
