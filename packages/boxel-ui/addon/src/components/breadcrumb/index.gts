import { hash } from '@ember/helper';
import Component from '@glimmer/component';
import { TemplateOnlyComponent } from '@ember/component/template-only';
import type { ComponentLike } from '@glint/template';

export type BoxelButtonKind =
  | 'primary'
  | 'secondary-dark'
  | 'secondary-light'
  | 'danger'
  | 'primary-dark'
  | 'text-only';

export type BoxelButtonSize =
  | 'extra-small'
  | 'small'
  | 'base'
  | 'tall'
  | 'touch';

interface Signature {
  Args: {};
  Blocks: {
    default: [{ Item: ComponentLike<BreadCrumbItemSignature> }];
  };
  Element: HTMLButtonElement | HTMLAnchorElement;
}

export default class BreadCrumb extends Component<Signature> {
  <template>
    <div>
      <ol class='breadCrumb-list'>
        {{yield (hash Item=(component BreadCrumbItem className='item'))}}
        {{! <li>Home</li>
        <li>Components</li>
        <li>BreadCrumb</li> }}
      </ol>
    </div>
    <style>
      .breadCrumb-list {
        display: flex;
        flex-wrap: wrap;
        gap: 1rem;
        list-style: none;
      }
    </style>
  </template>
}

export interface BreadCrumbItemSignature {
  Args: {
    className?: string;
    isOpen?: boolean;
    onClick?: (event: MouseEvent) => void;
  };
  Blocks: {
    content: [];
  };
  Element: HTMLDivElement;
}

const BreadCrumbItem: TemplateOnlyComponent<BreadCrumbItemSignature> =
  <template>{{yield to='content'}}</template>;
