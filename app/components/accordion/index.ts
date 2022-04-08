import Component from '@glimmer/component';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';

export default class Accordion extends Component {
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
      if (e.target.dataset.isAccordionTrigger) {
        this.isTriggerFocused = true;
      }
    }
  }

  @action
  handleFocusout(e: Event) {
    if (e.target instanceof HTMLElement) {
      if (e.target.dataset.isAccordionTrigger) {
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
        document.activeElement.dataset.isAccordionTrigger
      )
    ) {
      return;
    }

    if (event.repeat) return;

    let id = document.activeElement.id.replace(/-trigger$/, '');

    let index = this.items.findIndex((item) => item.id === id);
    if (index < this.items.length - 1) {
      document.getElementById(this.items[index + 1].id + '-trigger')?.focus();
    } else {
      document.getElementById(this.items[0].id + '-trigger')?.focus();
    }

    event.preventDefault();
  }

  @action jumpToPreviousTrigger(event: KeyboardEvent) {
    if (
      !(
        document.activeElement instanceof HTMLElement &&
        document.activeElement.dataset.isAccordionTrigger
      )
    ) {
      return;
    }

    if (event.repeat) return;

    let id = document.activeElement.id.replace(/-trigger$/, '');

    let index = this.items.findIndex((item) => item.id === id);
    if (index > 0) {
      document.getElementById(this.items[index - 1].id + '-trigger')?.focus();
    } else {
      document
        .getElementById(this.items[this.items.length - 1].id + '-trigger')
        ?.focus();
    }

    event.preventDefault();
  }
}
