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

  @tracked isFocused = false;
  @tracked currentItem = '';

  @action
  handleFocusin(e: Event) {
    if (e.target instanceof HTMLElement) {
      if (e.target.dataset.isAccordionTrigger) {
        this.isFocused = true;
      }
    }
  }

  @action
  handleFocusout(e: Event) {
    if (e.target instanceof HTMLElement) {
      if (e.target.dataset.isAccordionTrigger) {
        this.isFocused = false;
      }
    }
  }

  @action
  handleTrigger(target: string) {
    this.currentItem = target;
  }
}
