import { type EmptyObject } from '@ember/component/helper';
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import type { ComponentLike } from '@glint/template';

import BoxelButton, { type BoxelButtonKind } from '../../button/index.gts';
import BoxelIconButton, {
  type Signature as BoxelIconButtonSignature,
} from '../../icon-button/index.gts';

interface ButtonSignature {
  Args: {
    kind?: BoxelButtonKind;
  };
  Blocks: {
    default: [];
  };
  Element: HTMLButtonElement | HTMLAnchorElement;
}

export const Button: TemplateOnlyComponent<ButtonSignature> = <template>
  <BoxelButton
    class='accessory button-accessory'
    @kind={{@kind}}
    data-test-boxel-input-group-button-accessory
    ...attributes
  >
    {{yield}}
  </BoxelButton>
  <style>
    .accessory {
      border: 1px solid var(--boxel-input-group-border-color);
      border-radius: var(--boxel-input-group-border-radius);
      transition: border-color var(--boxel-transition);
      margin: 0;
      min-height: var(--boxel-input-group-height);
      outline-offset: 0;
    }

    .button-accessory {
      z-index: 2;
    }

    .button-accessory:focus {
      z-index: 5;
    }
  </style>
</template>;

interface IconButtonSignature {
  Args: Pick<BoxelIconButtonSignature['Args'], 'icon' | 'width' | 'height'>;
  Blocks: {
    default: [];
  };
  Element: HTMLButtonElement;
}

export const IconButton: TemplateOnlyComponent<IconButtonSignature> = <template>
  <BoxelIconButton
    class='accessory icon-button-accessory'
    @icon={{@icon}}
    @height={{@height}}
    @width={{@width}}
    data-test-boxel-input-group-icon-button-accessory
    ...attributes
  />
  <style>
    .accessory {
      border: 1px solid var(--boxel-input-group-border-color);
      border-radius: var(--boxel-input-group-border-radius);
      transition: border-color var(--boxel-transition);
      margin: 0;
      min-height: var(--boxel-input-group-height);
      outline-offset: 0;
    }

    .icon-button-accessory {
      z-index: 2;
    }
  </style>
</template>;

interface TextSignature {
  Args: EmptyObject;
  Blocks: { default: [] };
  Element: HTMLSpanElement;
}

export const Text: TemplateOnlyComponent<TextSignature> = <template>
  <span
    class='accessory text-accessory'
    data-test-boxel-input-group-text-accessory
    ...attributes
  >{{yield}}</span>
  <style>
    .accessory {
      border: 1px solid var(--boxel-input-group-border-color);
      border-radius: var(--boxel-input-group-border-radius);
      transition: border-color var(--boxel-transition);
      margin: 0;
      min-height: var(--boxel-input-group-height);
      outline-offset: 0;
    }

    .text-accessory {
      align-items: center;
      background-color: var(--boxel-light);
      color: var(--boxel-purple-900);
      display: flex;
      font-size: var(--boxel-font-size-sm);
      line-height: var(--boxel-ratio);
      padding: var(--boxel-input-group-padding-y)
        var(--boxel-input-group-padding-x);
      text-align: center;
      white-space: nowrap;
    }
  </style>
</template>;

export interface AccessoriesBlockArg {
  Button: ComponentLike<ButtonSignature>;
  IconButton: ComponentLike<IconButtonSignature>;
  Text: ComponentLike<TextSignature>;
}
