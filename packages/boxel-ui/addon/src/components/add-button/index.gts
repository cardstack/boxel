import type { TemplateOnlyComponent } from '@ember/component/template-only';

import PlusIcon from '../../icons/icon-plus.gts';
import IconButton from '../icon-button/index.gts';

interface Signature {
  Args: {
    iconHeight?: string;
    iconWidth?: string;
    loading?: boolean;
  };
  Blocks: {
    default: [];
  };
  Element: HTMLElement;
}

const AddButton: TemplateOnlyComponent<Signature> = <template>
  <IconButton
    @loading={{@loading}}
    @icon={{PlusIcon}}
    @width={{if @iconWidth @iconWidth '20px'}}
    @height={{if @iconHeight @iconHeight '20px'}}
    class='boxel-add-button'
    aria-label={{if @loading 'loading' 'add'}}
    data-test-create-new-card-button
    ...attributes
  />

  <style scoped>
    .boxel-add-button {
      --boxel-icon-button-background: var(--background, var(--boxel-100));
      --boxel-icon-button-color: var(--foreground, var(--boxel-dark));
      --icon-color: var(--boxel-icon-button-color);
      border-radius: 50%;
      border: none;
      box-shadow: var(--shadow, 0 4px 6px 0px rgb(0 0 0 / 35%));
    }
    .boxel-add-button:not(:disabled):hover {
      --boxel-icon-button-background: var(--accent, var(--boxel-200));
      --boxel-icon-button-color: var(--accent-foreground, var(--boxel-dark));
    }
  </style>
</template>;

export default AddButton;
