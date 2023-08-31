import Component from '@glimmer/component';

export default class Accordion extends Component {
  <template>
    <div class='accordion'>
      <details class='accordion-item'>
        <summary class='title'>Schema Editor</summary>
        <div class='content'>I'm a schema editor</div>
      </details>
      <details class='accordion-item'>
        <summary class='title'>Playground</summary>
        <div class='content'>Play here!</div>
      </details>
      <details class='accordion-item'>
        <summary class='title'>Lorem ipsum dolor sit amet, consectetur
          adipiscing elit sed do eiusmod tempor incididunt ut labore</summary>
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
    <style>
      .accordion {
        --accordion-border: var(--boxel-border);
        --accordion-border-radius: var(--boxel-border-radius-xl);
        --accordion-item-closed-min-height: 40px;
        --accordion-item-open-min-height: 500px;
        --accordion-item-title-font: 700 var(--boxel-font);
        --accordion-item-title-letter-spacing: var(--boxel-lsp-xs);
        --accordion-item-title-padding: var(--boxel-sp-xs);
        --accordion-item-content-padding: var(--boxel-sp-xs);

        border: var(--accordion-border);
        border-radius: var(--accordion-border-radius);
      }
      .accordion > * + * {
        border-top: var(--accordion-border);
      }
      .accordion-item {
        min-height: var(--accordion-item-closed-min-height);
        transition: min-height var(--boxel-transition);
      }
      .accordion-item[open] {
        min-height: var(--accordion-item-open-min-height);
      }
      .accordion-item > .content {
        height: 0;
        transition: min-height var(--boxel-transition);
      }
      .accordion-item[open] > .content {
        min-height: max-content;
      }
      .title {
        padding: var(--accordion-item-title-padding);
        font: var(--accordion-item-title-font);
        letter-spacing: var(--accordion-item-title-letter-spacing);
      }
      .title:hover {
        cursor: pointer;
      }
      .content {
        padding: var(--accordion-item-content-padding);
        border-top: var(--accordion-border);
      }
    </style>
  </template>
}
