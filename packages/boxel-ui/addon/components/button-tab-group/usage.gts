import Component from '@glimmer/component';
import ButtonTabGroup from './index';
import { tracked } from '@glimmer/tracking';
import { fn } from '@ember/helper';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import { action } from '@ember/object';

export default class ButtonTabGroupUsage extends Component {
  @tracked activeName = 'a';
  @action
  onTabSelect(name: string) {
    this.activeName = name;
  }
  <template>
    <FreestyleUsage @name='ButtonTabGroup'>
      <:example>
        <ButtonTabGroup
          @activeName={{this.activeName}}
          @onTabSelect={{this.onTabSelect}}
          as |Tabs Panels|
        >
          <Tabs as |Tab|>
            <Tab @name='a' @title='First' />
            <Tab @name='b' @title='Second' />
          </Tabs>
          <Panels as |Panel|>
            <Panel @name='a'>
              <div>
                Contents of First Panel
              </div>
            </Panel>
            <Panel @name='b'>
              <div>
                Contents of Second Panel
              </div>
            </Panel>
          </Panels>
        </ButtonTabGroup>
      </:example>
      <:api as |Args|>
        <Args.Number
          @name='activeIndex'
          @description='The index of the tab which should currently be shown.'
          @value={{this.activeIndex}}
          @onInput={{fn (mut this.activeIndex)}}
          @required={{true}}
        />
      </:api>
    </FreestyleUsage>
  </template>
}
