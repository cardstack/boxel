import { BaseDef } from 'https://cardstack.com/base/card-api';
import GlimmerComponent from '@glimmer/component';

export function cardTypeDisplayName(cardOrField: BaseDef): string {
  return cardOrField.constructor.getDisplayName(cardOrField);
}

export function cardTypeIcon(cardOrField: BaseDef): GlimmerComponent {
  return cardOrField.constructor.getIconComponent(cardOrField);
}
