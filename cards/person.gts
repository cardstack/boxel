import { contains, field, Component, Card } from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';
import BooleanCard from 'https://cardstack.com/base/boolean';
import Modifier from 'ember-modifier';

export class Person extends Card {
  @field firstName = contains(StringCard);
  @field lastName = contains(StringCard);
  @field isCool = contains(BooleanCard);
  @field isHuman = contains(BooleanCard);
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div {{CardShadow @model.constructor.name}}>
        <@fields.firstName/> <@fields.lastName />
      </div>
    </template>
  }
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <div {{CardShadow @model.constructor.name}}>
        <h1><@fields.firstName/> <@fields.lastName /></h1>
        <div><@fields.isCool/></div>
        <div><@fields.isHuman/></div>
      </div>
    </template>
  }
}

interface Signature {
  element: HTMLElement;
  Args: {
    Positional: [className: string | undefined]
  };
}

class CardShadow extends Modifier<Signature> {
  modify(
    element: HTMLElement,
    [className]: Signature["Args"]["Positional"]
  ) {
    const shadow = element.attachShadow({ mode: 'open' });
    
    const wrapper = document.createElement('div');
    wrapper.innerHTML = element.innerHTML;

    if (className) {
      wrapper.setAttribute('class', className);
    }

    const styles = document.createElement('style');
    styles.textContent = `
      .Person {
        background-color: #90dbf4;
        border: 1px solid gray;
        border-radius: 10px;
        padding: 1rem;
      }
    `;

    shadow.appendChild(wrapper);
    shadow.appendChild(styles);
  }
}