import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { array } from '@ember/helper';
import { noop } from 'lodash';
import { BoxelDropdown, Button, Menu } from '@cardstack/boxel-ui/components';
import { menuItem } from '@cardstack/boxel-ui/helpers';
import { IconPlus } from '@cardstack/boxel-ui/icons';

const NewFileButton: TemplateOnlyComponent = <template>
  <BoxelDropdown>
    <:trigger as |bindings|>
      <Button
        {{bindings}}
        @kind='primary'
        @size='small'
        class='new-file-button'
        data-test-new-file-button
      >
        <IconPlus
          @width='var(--boxel-icon-sm)'
          @height='var(--boxel-icon-sm)'
          stroke='var(--boxel-light)'
          stroke-width='1px'
          aria-label='Add'
          class='new-file-button-icon'
        />
        New File
      </Button>
    </:trigger>
    <:content as |dd|>
      <Menu
        @items={{array (menuItem 'Card Instance' noop disabled=true)}}
        @closeMenu={{dd.close}}
      />
    </:content>
  </BoxelDropdown>
  <style>
    .new-file-button {
      --new-file-button-width: 7.5rem;
      --new-file-button-height: var(--boxel-form-control-height);
      --boxel-button-text-color: var(--boxel-light);

      height: var(--new-file-button-height);
      width: var(--new-file-button-width);
      margin-left: var(--boxel-sp);
    }
    .new-file-button-icon {
      --icon-color: var(--boxel-light);
      flex-shrink: 0;
      margin-right: var(--boxel-sp-5xs);
    }
  </style>
</template>;

export default NewFileButton;
