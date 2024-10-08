import type { TemplateOnlyComponent } from '@ember/component/template-only';
import type Owner from '@ember/owner';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { restartableTask, timeout } from 'ember-concurrency';

import type { ComponentLike } from '@glint/template';

interface ContentSignature {
  Element: HTMLElement;
  Blocks: {
    default: [];
  };
  Args: {
    withMask?: boolean;
    whenVisible?: (setVisible: () => void) => void;
  };
}

class InnerContainerContent extends Component<ContentSignature> {
  <template>
    <section
      class='inner-container__content {{if this.showMask "mask"}}'
      ...attributes
    >
      {{yield}}
    </section>
    <style scoped>
      .inner-container__content {
        position: relative;
        padding: var(--boxel-sp-xxs) var(--boxel-sp-xs) var(--boxel-sp-sm);
        overflow-y: auto;
        height: 100%;
      }
      .inner-container__header + .inner-container__content {
        padding-top: 0;
      }
      .mask {
        scrollbar-color: white white;
      }
      .mask::-webkit-scrollbar {
        height: 10px;
        width: 12px;
      }
      .mask::-webkit-scrollbar-thumb {
        background: white;
      }
      .mask::-webkit-scrollbar-track {
        background: white;
      }
    </style>
  </template>

  @tracked private showMask = this.args.withMask;
  constructor(owner: Owner, args: ContentSignature['Args']) {
    super(owner, args);
    if (this.args.withMask) {
      this.setVisible();
      this.args.whenVisible?.(this.setVisible);
    }
  }

  private setVisible = () => {
    this.showMask = true;
    this.hideMask.perform();
  };

  private hideMask = restartableTask(async () => {
    // fine tuned to coincide with debounce in RestoreScrollPosition modifier
    await timeout(300);
    this.showMask = false;
  });
}
interface HeaderSignature {
  Element: HTMLElement;
  Blocks: {
    default: [];
  };
}

const InnerContainerHeader: TemplateOnlyComponent<HeaderSignature> = <template>
  <header class='inner-container__header' ...attributes>
    {{yield}}
  </header>
  <style scoped>
    .inner-container__header {
      padding: var(--boxel-sp-sm) var(--boxel-sp-xs);
      font: 600 var(--boxel-font-sm);
      letter-spacing: var(--boxel-lsp-xs);
    }
  </style>
</template>;

interface Signature {
  Element: HTMLDivElement;
  Args: {};
  Blocks: {
    default: [ComponentLike<ContentSignature>, ComponentLike<HeaderSignature>];
  };
}

const CodeSubmodeInnerContainer: TemplateOnlyComponent<Signature> = <template>
  <div class='inner-container' ...attributes>
    {{yield (component InnerContainerContent) (component InnerContainerHeader)}}
  </div>
  <style scoped>
    .inner-container {
      height: 100%;
      position: relative;
      display: flex;
      flex-direction: column;
      background-color: var(--boxel-light);
      border-radius: var(--boxel-border-radius-xl);
      box-shadow: var(--boxel-deep-box-shadow);
      overflow: hidden;
    }
  </style>
</template>;

export default CodeSubmodeInnerContainer;
