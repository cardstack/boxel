import Component from '@glimmer/component';
import { WithBoundArgs } from '@glint/template';
import ButtonTab from './tab';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { TrackedMap } from 'tracked-built-ins';

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
    currentTabTitle?: string;
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
    <header
      class='header'
      aria-label={{@currentTabTitle}}
      data-test-button-tab-group-header
    >
      {{yield
        (component
          ButtonTab
          registerTab=@registerTab
          unregisterTab=@unregisterTab
          activeName=@activeName
          onTabSelect=@onTabSelect
        )
      }}
    </header>
  </template>
}

interface PanelsSignature {
  Element: HTMLElement;
  Args: {
    activeName: string;
    registerPanel: (name: string) => void;
    unregisterPanel: (name: string) => void;
  };
  Blocks: {
    default: [
      WithBoundArgs<
        typeof Panel,
        'registerPanel' | 'unregisterPanel' | 'activeName'
      >,
    ];
  };
}

class Panels extends Component<PanelsSignature> {
  <template>
    <section class='inner-container' ...attributes>
      {{yield
        (component
          Panel
          registerPanel=@registerPanel
          unregisterPanel=@unregisterPanel
          activeName=@activeName
        )
      }}
    </section>
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
export type TabInfo = {
  name: string;
  title: string;
};

export default class ButtonTabGroup extends Component<Signature> {
  get currentTabTitle() {
    return 'TODO';
  }
  @tracked tabInfos: TrackedMap<string, TabInfo> = new TrackedMap();

  @action registerTab(tabInfo: TabInfo) {
    this.tabInfos.set(tabInfo.name, tabInfo);
  }

  @action unregisterTab(tabInfo: TabInfo) {
    this.tabInfos.delete(tabInfo.name);
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
          currentTabTitle='Howdy'
        )
        (component
          Panels
          registerPanel=this.registerPanel
          unregisterPanel=this.unregisterPanel
          activeName=@activeName
        )
      }}
    </div>
    <style></style>
  </template>
}
