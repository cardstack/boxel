import Component from '@glimmer/component';

interface Signature {
  title: string;
  // content: string;
  // isOpen: boolean;
  // toggle: () => void;
}

export default class Accordion extends Component<Signature> {
  <template>
    <div class='accordion'>
      <details>
        <summary class='title'>Schema Editor</summary>
        <div class='content'>I'm a schema editor</div>
      </details>
      <details>
        <summary class='title'>Playground</summary>
        <div class='content'>Play here!</div>
      </details>
      <details>
        <summary class='title'>Last item with a longer name</summary>
        <div class='content'>Lorem ipsum dolor sit amet, consectetur adipiscing
          elit, sed do eiusmod tempor incididunt ut labore et dolore magna
          aliqua. Odio eu feugiat pretium nibh ipsum consequat nisl vel pretium.
          Massa tempor nec feugiat nisl pretium fusce. Vestibulum mattis
          ullamcorper velit sed ullamcorper morbi tincidunt ornare massa. Neque
          vitae tempus quam pellentesque. Magna etiam tempor orci eu. Dui id
          ornare arcu odio ut sem nulla pharetra. Egestas dui id ornare arcu
          odio. Ante metus dictum at tempor. Diam maecenas ultricies mi eget
          mauris. Tristique nulla aliquet enim tortor at auctor urna. Sodales ut
          eu sem integer vitae justo eget magna. Adipiscing enim eu turpis
          egestas pretium aenean. At elementum eu facilisis sed odio morbi quis
          commodo odio. Risus ultricies tristique nulla aliquet enim tortor at
          auctor urna. Amet consectetur adipiscing elit ut. Pellentesque
          adipiscing commodo elit at imperdiet dui accumsan. Sed blandit libero
          volutpat sed.
        </div>
      </details>
    </div>
  </template>
}
