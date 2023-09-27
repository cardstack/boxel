import Owner from '@ember/owner';
import type { TabInfo } from './index';
import Component from '@glimmer/component';
//@ts-ignore cached not available yet in definitely typed
import { cached } from '@glimmer/tracking';
import Button from '../button';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';

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
      name: this.args.name,
      title: this.args.title,
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
    <Button
      @disabled={{@disabled}}
      {{on 'click' (fn @onTabSelect @name)}}
      ...attributes
    >{{@title}}</Button>
    <style></style>
  </template>
}
