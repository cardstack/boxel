import { fn } from '@ember/helper';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import { eq } from '../../helpers/truth-helpers.ts';
import Accordion from './index.gts';

export default class AccordionUsage extends Component {
  <template>
    <FreestyleUsage @name='Accordion'>
      <:example>
        <Accordion as |A|>
          <A.Item
            @id='schema'
            @onClick={{fn this.selectItem 'schema'}}
            @isOpen={{eq this.selectedItem 'schema'}}
          >
            <:title>Schema Editor</:title>
            <:content><p>Content</p></:content>
          </A.Item>
          <A.Item
            @id='playground'
            @onClick={{fn this.selectItem 'playground'}}
            @isOpen={{eq this.selectedItem 'playground'}}
          >
            <:title>Playground</:title>
            <:content><p>Content</p></:content>
          </A.Item>
          <A.Item
            @id='item'
            @onClick={{fn this.selectItem 'item'}}
            @isOpen={{eq this.selectedItem 'item'}}
            @disabled={{true}}
          >
            <:title>Disabled item</:title>
            <:content><p>Content</p></:content>
          </A.Item>
          <A.Item
            @id='other'
            @onClick={{fn this.selectItem 'other'}}
            @isOpen={{eq this.selectedItem 'other'}}
          >
            <:title>Lorem ipsum dolor sit amet, consectetur adipiscing elit sed
              do eiusmod tempor incididunt ut labore</:title>
            <:content>
              <p>
                Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do
                eiusmod tempor incididunt ut labore et dolore magna aliqua. Odio
                eu feugiat pretium nibh ipsum consequat nisl vel pretium. Massa
                tempor nec feugiat nisl pretium fusce. Vestibulum mattis
                ullamcorper velit sed ullamcorper morbi tincidunt ornare massa.
                Neque vitae tempus quam pellentesque. Magna etiam tempor orci
                eu. Dui id ornare arcu odio ut sem nulla pharetra. Egestas dui
                id ornare arcu odio. Ante metus dictum at tempor. Diam maecenas
                ultricies mi eget mauris. Tristique nulla aliquet enim tortor at
                auctor urna. Sodales ut eu sem integer vitae justo eget magna.
                Adipiscing enim eu turpis egestas pretium aenean. At elementum
                eu facilisis sed odio morbi quis commodo odio. Risus ultricies
                tristique nulla aliquet enim tortor at auctor urna. Amet
                consectetur adipiscing elit ut. Pellentesque adipiscing commodo
                elit at imperdiet dui accumsan. Sed blandit libero volutpat sed.
              </p>
            </:content>
          </A.Item>
        </Accordion>
      </:example>
      <:cssVars as |Css|>
        <Css.Basic
          @name='--accordion-border'
          @type='border'
          @description='Separator between items.'
        />
        <Css.Basic
          @name='--accordion-item-title-min-height'
          @type='min-height'
          @description='Sets min-height for accordion item title.'
        />
        <Css.Basic
          @name='--accordion-item-content-min-height'
          @type='min-height'
          @description='Sets min-height for accordion item content.'
        />
        <Css.Basic
          @name='--accordion-item-trigger-padding'
          @type='padding'
          @description='Trigger padding'
        />
      </:cssVars>
    </FreestyleUsage>
    <style scoped>
      p {
        padding-left: var(--boxel-sp-sm);
      }
    </style>
  </template>

  @tracked selectedItem: string | null = null;

  @action selectItem(item: string) {
    if (this.selectedItem === item) {
      this.selectedItem = null;
      return;
    }
    this.selectedItem = item;
  }
}
