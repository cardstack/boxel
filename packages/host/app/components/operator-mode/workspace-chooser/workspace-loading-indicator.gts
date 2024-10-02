import { TemplateOnlyComponent } from '@ember/component/template-only';

import { LoadingIndicator } from '@cardstack/boxel-ui/components';
import ItemContainer from './item-container';

interface Signature {
  Blocks: {
    default: [];
  };
  Element: HTMLElement;
}

const WorkspaceLoadingIndicator: TemplateOnlyComponent<Signature> = <template>
  <ItemContainer class='workspace' data-test-workspace-loading-indicator>
    <div class='loading-small-icon' />
    <LoadingIndicator @color='var(--boxel-light)' />
  </ItemContainer>
  <style scoped>
    .workspace {
      min-width: 251.6px;
      width: 251.6px;
      height: 215.3px;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      border-radius: 15px;
      border: none;
      background-color: rgba(0, 0, 0, 0.5);
      overflow: hidden;
      padding: 0;

      position: relative;

      --icon-color: var(--boxel-light);
    }
    .loading-small-icon {
      position: absolute;
      width: 20px;
      height: 20px;
      top: var(--boxel-sp-xs);
      left: var(--boxel-sp-xs);
      background: var(--boxel-dark);
      border-radius: 5px;
    }
  </style>
</template>;

export default WorkspaceLoadingIndicator;
