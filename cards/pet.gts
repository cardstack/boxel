import { contains, field, Card, Component } from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';
import IntegerCard from 'https://cardstack.com/base/integer';
import BooleanCard from 'https://cardstack.com/base/boolean';

import { modifier } from 'ember-modifier';
// import { on } from '@ember/modifier';
import { tracked } from '@glimmer/tracking';


let sheet: CSSStyleSheet | undefined;
if (typeof CSSStyleSheet !== 'undefined') {
  sheet = new CSSStyleSheet();
  sheet.replaceSync(`
    this {
      border: 1px solid gray;
      border-radius: 10px;
      background-color: red;
      padding: 1rem;
    }
  `);
}

const sheetScopes = new WeakMap();
let scopeCounter = 0;

const attach = modifier<{ Args: { Positional: [CSSStyleSheet | undefined] }}>((element, [sheet]) => {
  if (!sheet) {
    return;
  }

  for (let rule of Array.from(sheet.cssRules)) {
    if (rule.selectorText === 'this') {
      let className = sheetScopes.get(sheet);
      if (className == null) {
        className = 'i' + scopeCounter++;
        sheetScopes.set(sheet, className);
      }
      rule.selectorText = '.' + className;
      element.classList.add(className);
    }
  }

  let current: Node | null = element;
  while (current) {
    if ('adoptedStyleSheets' in current) {
      let root = current as any;
      root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
      return () => {
        let newSheets = [...root.adoptedStyleSheets];
        newSheets.splice(root.adoptedStyleSheets.indexOf(sheet), 1);
        root.adoptedStyleSheets = newSheets;
      };
    }
    current = current.parentNode;
  }
  throw new Error(`bug: found no root to append styles into`);
}, { eager: false });

class Embedded extends Component<typeof Pet> {
  @tracked applyStyles = false;
  toggleStyles = () => { this.applyStyles = !this.applyStyles };

  @tracked applyStyles2 = false;
  toggleStyles2 = () => { this.applyStyles2 = !this.applyStyles2 };

  <template>
    {{!-- <button {{on "click" this.toggleStyles}}>Toggle Styles</button>
    {{#if this.applyStyles}}
      <div {{attach sheet }}>Styles are active because of First</div>
    {{/if}}

    <button {{on "click" this.toggleStyles2}}>Toggle Styles2</button>
     {{#if this.applyStyles2}}
      <div {{attach sheet }}>Styles are active because of Second</div>
    {{/if}} --}}

    <div {{attach sheet}}><@fields.firstName/></div>
  </template>
}

export class Pet extends Card {
  @field firstName = contains(StringCard);
  @field favoriteToy = contains(StringCard);
  @field favoriteTreat = contains(StringCard);
  @field cutenessRating = contains(IntegerCard);
  @field sleepsOnTheCouch = contains(BooleanCard);
  static embedded = Embedded;
}