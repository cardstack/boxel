import type { TemplateOnlyComponent } from '@ember/component/template-only';

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
      min-width: var(--boxel-xxs-container);
      width: var(--boxel-xxs-container);
      height: 10.375rem;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      border-radius: var(--boxel-border-radius-xl);
      border: none;
      background-color: rgba(0, 0, 0, 0.5);
      overflow: hidden;
      padding: 0;

      position: relative;

      --icon-color: var(--boxel-light);
    }
    .loading-small-icon {
      position: absolute;
      width: var(--boxel-icon-sm);
      height: var(--boxel-icon-sm);
      top: var(--boxel-sp-xs);
      left: var(--boxel-sp-xs);
      background: var(--boxel-dark);
      border-radius: var(--boxel-border-radius-sm);
    }
  </style>
</template>;

export default WorkspaceLoadingIndicator;
