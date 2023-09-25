import Component from '@glimmer/component';
import { WithBoundArgs } from '@glint/template';
import ButtonTab from './tab';
import Button from '../button';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { eq } from '@cardstack/boxel-ui/helpers/truth-helpers';
import cn from '@cardstack/boxel-ui/helpers/cn';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';

interface PanelSignature {
  Element: HTMLElement;
  Args: {
    name: string;
    title: string;
    disabled: boolean;
    activeName: string;
    onTabSelect: (name: string) => void;
    registerPanel: (name: string) => void;
    unregisterPanel: (name: string) => void;
  };
  Blocks: {
    default: [];
  };
}

class Panel extends Component<PanelSignature> {
  <template>
    {{yield}}
  </template>
}

interface TabsSignature {
  Args: {
    activeName: string;
    onTabSelect: (name: string) => void;
    registerTab: (name: string) => void;
    unregisterTab: (name: string) => void;
  };
  Blocks: {
    default: [
      WithBoundArgs<
        typeof ButtonTab,
        'registerTab' | 'unregisterTab' | 'activeName' | 'onTabSelect'
      >,
    ];
  };
}

class Tabs extends Component<TabsSignature> {
  <template>
    {{yield
      (component
        ButtonTab
        registerTab=@registerTab
        unregisterTab=@unregisterTab
        activeName=@activeName
        onTabSelect=@onTabSelect
      )
    }}
  </template>
}

interface PanelsSignature {
  Args: {
    activeName: string;
    registerPanel: (name: string) => void;
    unregisterPanel: (name: string) => void;
  };
  Blocks: {
    default: [
      WithBoundArgs<
        typeof ButtonTab,
        'registerPanel' | 'unregisterPanel' | 'activeName'
      >,
    ];
  };
}

class Panels extends Component<PanelsSignature> {
  <template>
    {{yield
      (component
        Panel
        registerPanel=@registerPanel
        unregisterPanel=@unregisterPanel
        activeName=@activeName
      )
    }}
  </template>
}

interface Signature {
  Element: HTMLDivElement;
  Args: {
    activeName: string;
    onTabSelect: (name: string) => void;
  };
  Blocks: {
    default: [
      WithBoundArgs<typeof Tabs, 'registerTab' | 'unregisterTab'>,
      WithBoundArgs<typeof Panels, 'registerPanel' | 'unregisterPanel'>,
    ];
  };
}

export default class ButtonTabGroup extends Component<Signature> {
  get currentTabTitle() {
    return 'TODO';
  }
  @tracked tabInfos: TabInfo[] = [];

  @action registerTab(tabInfo: TabInfo) {
    // this.tabInfos = this.tabInfos.concat([tabInfo]);
  }

  @action unregisterTab(tabInfo: TabInfo) {
    // this.tabInfos = this.tabInfos.filter((ti) => ti !== tabInfo);
  }

  @action registerPanel() {
    // this.tabInfos = this.tabInfos.concat([tabInfo]);
  }

  @action unregisterPanel() {
    // this.tabInfos = this.tabInfos.filter((ti) => ti !== tabInfo);
  }

  <template>
    <div class='button-tab-group'>
      {{yield
        (component
          Tabs
          registerTab=this.registerTab
          unregisterTab=this.unregisterTab
          onTabSelect=@onTabSelect
          activeName=@activeName
        )
        (component
          Panels
          registerPanel=this.registerPanel
          unregisterPanel=this.unregisterPanel
          activeName=@activeName
        )
      }}
      {{!-- <header
        class='header'
        aria-label={{this.currentTabTitle}}
        data-test-button-tab-group-header
      >
        {{#each this.tabInfos as |tabInfo index|}}
          {{#let (eq index @activeIndex) as |isActive|}}
            <Button
              @disabled={{tabInfo.disabled}}
              @kind={{if isActive 'primary-dark' 'secondary'}}
              @size='extra-small'
              class={{cn 'header-button' active=isActive}}
              {{on 'click' (fn @onTabSelect index)}}
              data-test-tab-button={{tabInfo.title}}
            >
              {{tabInfo.title}}
            </Button>
          {{/let}}
        {{/each}}
      </header>
      <section class='inner-container__content'>
        {{yield
          (component
            ButtonTab
            registerTab=this.registerTab
            unregisterTab=this.unregisterTab
          )
        }}
      </section> --}}
    </div>
    <style></style>
  </template>
}
