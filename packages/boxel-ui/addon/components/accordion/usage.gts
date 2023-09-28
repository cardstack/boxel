import Component from '@glimmer/component';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import { action } from '@ember/object';
import { fn } from '@ember/helper';
import { tracked } from '@glimmer/tracking';
import cssVars from '@cardstack/boxel-ui/helpers/css-var';
import { eq } from '@cardstack/boxel-ui/helpers/truth-helpers';
import {
  cssVariable,
  CSSVariableInfo,
} from 'ember-freestyle/decorators/css-variable';
import Accordion from './index';

export default class AccordionUsage extends Component {
  @cssVariable({ cssClassName: 'accordion' })
  declare defaultOpenHeight: CSSVariableInfo;

  <template>
    <FreestyleUsage @name='Accordion'>
      <:example>
        <Accordion
          style={{cssVars item-open-min-height=this.defaultOpenHeight.value}}
          as |A|
        >
          <A.Item
            class='a-item'
            @isOpen={{eq this.selectedItem 'schema'}}
            @onClick={{fn this.select 'schema'}}
          >
            <:title>Schema Editor</:title>
            <:content><p>Content</p></:content>
          </A.Item>
          <A.Item
            class='a-item'
            @isOpen={{eq this.selectedItem 'play'}}
            @onClick={{fn this.select 'play'}}
          >
            <:title>Playground</:title>
            <:content><p>Content</p></:content>
          </A.Item>
          <A.Item
            class='a-item'
            style={{cssVars item-open-min-height='20rem'}}
            @isOpen={{eq this.selectedItem 'other'}}
            @onClick={{fn this.select 'other'}}
          >
            <:title>LLorem ipsum dolor sit amet, consectetur adipiscing elit sed
              do eiusmod tempor incididunt ut labore</:title>
            <:content>
              <p>Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do
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
                elit at imperdiet dui accumsan. Sed blandit libero volutpat sed.</p>
            </:content>
          </A.Item>
        </Accordion>
      </:example>
      <:cssVars as |Css|>
        <Css.Basic
          @name='item-open-min-height'
          @type='min-height, height'
          @description='Sets a default min-height for accordion items when items are expanded. Can also be used to set height for an individual accordion item.'
          @value={{this.defaultOpenHeight.value}}
          @onInput={{this.defaultOpenHeight.update}}
        />
      </:cssVars>
    </FreestyleUsage>
    <style>
      p {
        margin: 0;
        padding: var(--boxel-sp);
      }
    </style>
  </template>

  @tracked selectedItem: string | null = null;

  @action select(item: string) {
    if (this.selectedItem === item) {
      this.selectedItem = null;
      return;
    }
    this.selectedItem = item;
  }
}
