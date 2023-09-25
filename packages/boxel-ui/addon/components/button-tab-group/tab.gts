import Owner from '@ember/owner';
import { TabInfo } from './index';
import Component from '@glimmer/component';
//@ts-ignore cached not available yet in definitely typed
import { cached } from '@glimmer/tracking';

interface Signature {
  Element: HTMLElement;
  Args: {
    name: string;
    title: string;
    disabled: boolean;
    activeName: string;
    onTabSelect: (name: string) => void;
    registerTab: (name: string) => void;
    unregisterTab: (name: string) => void;
  };
  Blocks: {
    default: [];
  };
}
export default class Tab extends Component<Signature> {
  @cached
  get tabInfo(): TabInfo {
    return {
      title: this.args.title,
      disabled: this.args.disabled,
    };
  }

  constructor(owner: Owner, args: any) {
    super(owner, args);
    this.args.registerTab(this.tabInfo);
  }

  willDestroy() {
    this.args.unregisterTab(this.tabInfo);
    super.willDestroy();
  }

  <template>
    <section ...attributes>
      {{yield}}
    </section>
    <style></style>
  </template>
}
