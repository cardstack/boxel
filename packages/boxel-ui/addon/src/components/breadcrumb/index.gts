import Component from '@glimmer/component';
import type { TemplateOnlyComponent } from '@ember/component/template-only';
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
    default: [ComponentLike<BreadcrumbItemSignature>];
  };
  Element: HTMLButtonElement | HTMLAnchorElement;
}

export default class Breadcrumb extends Component<Signature> {
  <template>
    <div>
      <ol class='breadcrumb-list'>
        {{yield (component BreadcrumbItem)}}
      </ol>
    </div>
    <style>
      .breadcrumb-list {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 1rem;
        list-style: none;
      }
    </style>
  </template>
}

export interface BreadcrumbItemSignature {
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

const BreadcrumbItem: TemplateOnlyComponent<BreadcrumbItemSignature> =
  <template>{{yield to='content'}}</template>;
