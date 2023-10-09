import Component from '@glimmer/component';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import { tracked } from '@glimmer/tracking';
import { fn } from '@ember/helper';
import { action } from '@ember/object';
import cssVars from '@cardstack/boxel-ui/helpers/css-var';
import { eq } from '@cardstack/boxel-ui/helpers/truth-helpers';
import Accordion from './index';

export default class AccordionUsage extends Component {
  <template>
    <FreestyleUsage @name='Accordion'>
      <:example>
        <Accordion as |A|>
          <A.Item
            class='item'
            @onClick={{fn this.selectItem 'schema'}}
            @isOpen={{eq this.selectedItem 'schema'}}
          >
            <:title>Schema Editor</:title>
            <:content><p>Content</p></:content>
          </A.Item>
          <A.Item
            class='item'
            @onClick={{fn this.selectItem 'playground'}}
            @isOpen={{eq this.selectedItem 'playground'}}
          >
            <:title>Playground</:title>
            <:content><p>Content</p></:content>
          </A.Item>
          <A.Item
            class='item'
            style={{cssVars accordion-item-closed-height='65px'}}
            @onClick={{fn this.selectItem 'other'}}
            @isOpen={{eq this.selectedItem 'other'}}
          >
            <:title>LLorem ipsum dolor sit amet, consectetur adipiscing elit sed
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
          @name='accordion-item-closed-height'
          @type='height'
          @description='Sets height for collapsed accordion item.'
        />
        <Css.Basic
          @name='accordion-item-open-height'
          @type='height'
          @description='Sets height for expanded accordion item.'
        />
      </:cssVars>
    </FreestyleUsage>
    <style>
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
