import type { TemplateOnlyComponent } from '@ember/component/template-only';
import IconButton from '../icon-button';

interface Signature {
  Element: HTMLElement;
}

const AddButton: TemplateOnlyComponent<Signature> = <template>
  <IconButton
    @icon='icon-plus-circle'
    @width='40px'
    @height='40px'
    class='add-button'
    title='Add'
    data-test-create-new-card-button
    ...attributes
  />
  <style>
    .add-button {
      --icon-bg: var(--boxel-light-100);
      --icon-border: var(--icon-bg);
      --icon-color: var(--boxel-highlight);

      border-radius: 100px;
      box-shadow: 0 4px 6px 0px rgb(0 0 0 / 35%);
    }

    .add-button:hover {
      --icon-bg: var(--boxel-light-200);
    }
  </style>
</template>;

export default AddButton;
