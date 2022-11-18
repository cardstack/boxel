import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

interface Signature {
  Element: HTMLDivElement;
}

export default class Accordion extends Component<Signature> {
  items = [
    {
      id: 'pi',
      title: 'Personal Information',
      fields: ['Name', 'Age'],
    },
    {
      id: 'mi',
      title: 'More Information',
      fields: ['Email'],
    },
    {
      id: 'emi',
      title: 'Even More Information',
      fields: ['IP Address', 'ZIP Code', 'Last Meal', "Pet's Name"],
    },
    {
      id: 'dsti',
      title: "Don't Stop The Information",
      fields: ['Favourite Song'],
    },
  ];

  @tracked isTriggerFocused = false;
  @tracked currentItem = '';

  @action
  handleFocusin(e: Event) {
    if (e.target instanceof HTMLElement) {
      if (e.target.dataset['isAccordionTrigger']) {
        this.isTriggerFocused = true;
      }
    }
  }

  @action
  handleFocusout(e: Event) {
    if (e.target instanceof HTMLElement) {
      if (e.target.dataset['isAccordionTrigger']) {
        this.isTriggerFocused = false;
      }
    }
  }

  @action
  handleTrigger(target: string) {
    this.currentItem = target;
  }

  @action jumpToNextTrigger(event: KeyboardEvent) {
    if (
      !(
        document.activeElement instanceof HTMLElement &&
        document.activeElement.dataset['isAccordionTrigger']
      )
    ) {
      return;
    }

    if (event.repeat) return;

    let id = document.activeElement.id.replace(/-trigger$/, '');

    let currentIndex = this.items.findIndex((item) => item.id === id);
    let nextIndex = currentIndex < this.items.length - 1 ? currentIndex + 1 : 0;
    let itemAtIndex = this.items[nextIndex];
    if (itemAtIndex) {
      document.getElementById(itemAtIndex.id + '-trigger')?.focus();
    } else {
      throw new Error('Could not find item to focus');
    }

    event.preventDefault();
  }

  @action jumpToPreviousTrigger(event: KeyboardEvent) {
    if (
      !(
        document.activeElement instanceof HTMLElement &&
        document.activeElement.dataset['isAccordionTrigger']
      )
    ) {
      return;
    }

    if (event.repeat) return;

    let id = document.activeElement.id.replace(/-trigger$/, '');

    let currentIndex = this.items.findIndex((item) => item.id === id);
    let nextIndex = currentIndex > 0 ? currentIndex - 1 : this.items.length - 1;
    let itemAtIndex = this.items[nextIndex];
    if (itemAtIndex) {
      document.getElementById(itemAtIndex.id + '-trigger')?.focus();
    } else {
      throw new Error('Could not find item to focus');
    }

    event.preventDefault();
  }
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    Accordion: typeof Accordion;
  }
}
