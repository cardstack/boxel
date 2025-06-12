import { fn } from '@ember/helper';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import type StoreService from '@cardstack/host/services/store';

import headerIcon from '../ai-assistant/ai-assist-icon@2x.webp';

import PillMenu from './index';

export default class PillMenuUsage extends Component {
  @service private declare store: StoreService;

  @tracked private title = 'Pill Menu';
  private headerIconURL = headerIcon;

  @action private onExpand() {
    console.log('Pill menu expanded');
  }

  @action private onCollapse() {
    console.log('Pill menu collapsed');
  }

  <template>
    <FreestyleUsage @name='PillMenu'>
      <:description>
        Component with a header and a list of card pills.
      </:description>
      <:example>
        <PillMenu @onExpand={{this.onExpand}} @onCollapse={{this.onCollapse}}>
          <:headerIcon>
            <img
              src={{this.headerIconURL}}
              width='18'
              height='18'
              alt='menu icon'
            />
          </:headerIcon>
          <:headerDetail>
            1 Active
          </:headerDetail>
          <:content>
            This is the content of the pill menu.
          </:content>
          <:footer>
            This is the footer of the pill menu.
          </:footer>
        </PillMenu>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='title'
          @description='Menu title displayed on the header'
          @value={{this.title}}
          @onInput={{fn (mut this.title)}}
        />
        <Args.Action
          @name='headerAction'
          @description='Action to take when header button is clicked.'
        />
      </:api>
    </FreestyleUsage>
  </template>
}
