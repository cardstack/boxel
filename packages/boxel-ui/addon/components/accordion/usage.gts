/* eslint-disable no-console */
import Component from '@glimmer/component';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import Accordion from './index';
import AccordionItem from './item';

export default class AccordionUsage extends Component {
  <template>
    <FreestyleUsage @name='Accordion'>
      <:example>
        <Accordion>
          <AccordionItem>
            <:title>Schema Editor</:title>
            <:content>Content</:content>
          </AccordionItem>
          <AccordionItem>
            <:title>Playground</:title>
            <:content>Content</:content>
          </AccordionItem>
          <AccordionItem>
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
          </AccordionItem>
        </Accordion>
      </:example>
      <:description>
      </:description>
    </FreestyleUsage>
  </template>
}
