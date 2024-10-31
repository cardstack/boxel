// @ts-expect-error: Module '/catalog/app-card' may not be available during compilation
import { AppCard } from '/catalog/app-card';
// import { Component } from 'https://cardstack.com/base/card-api';
import FlowerIcon from '@cardstack/boxel-icons/flower';

export class GardenAppCard extends AppCard {
  static displayName = 'Garden App Card';
  static icon = FlowerIcon;
  static headerColor = '#355e3b';
  /*
  static isolated = class Isolated extends Component<typeof this> {
    <template></template>
  }

  static embedded = class Embedded extends Component<typeof this> {
    <template></template>
  }

  static atom = class Atom extends Component<typeof this> {
    <template></template>
  }

  static edit = class Edit extends Component<typeof this> {
    <template></template>
  }







  */
}
