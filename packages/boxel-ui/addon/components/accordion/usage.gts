/* eslint-disable no-console */
import Component from '@glimmer/component';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import Accordion from './index';

export default class AccordionUsage extends Component {
  <template>
    <FreestyleUsage @name='Accordion'>
      <:example>
        <Accordion as |A|>
          <A.Item>
            <:title>Schema Editor</:title>
            <:content>Content</:content>
          </A.Item>
          <A.Item>
            <:title>Playground</:title>
            <:content>Content</:content>
          </A.Item>
          <A.Item>
            <:title>Lorem ipsum dolor sit amet, consectetur adipiscing elit sed
              do eiusmod tempor incididunt ut labore</:title>
            <:content>
              Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do
              eiusmod tempor incididunt ut labore et dolore magna aliqua. Odio
              eu feugiat pretium nibh ipsum consequat nisl vel pretium. Massa
              tempor nec feugiat nisl pretium fusce. Vestibulum mattis
              ullamcorper velit sed ullamcorper morbi tincidunt ornare massa.
              Neque vitae tempus quam pellentesque. Magna etiam tempor orci eu.
              Dui id ornare arcu odio ut sem nulla pharetra. Egestas dui id
              ornare arcu odio. Ante metus dictum at tempor. Diam maecenas
              ultricies mi eget mauris. Tristique nulla aliquet enim tortor at
              auctor urna. Sodales ut eu sem integer vitae justo eget magna.
              Adipiscing enim eu turpis egestas pretium aenean. At elementum eu
              facilisis sed odio morbi quis commodo odio. Risus ultricies
              tristique nulla aliquet enim tortor at auctor urna. Amet
              consectetur adipiscing elit ut. Pellentesque adipiscing commodo
              elit at imperdiet dui accumsan. Sed blandit libero volutpat sed.
            </:content>
          </A.Item>
        </Accordion>
      </:example>
      <:description>
        Use
        <code>--accordion-item-closed-min-height</code>
        and
        <code>--accordion-item-open-min-height</code>
        css variables in
        <code>AccordionItem</code>
        component to adjust the height of the accordion item.
      </:description>
    </FreestyleUsage>
  </template>
}
