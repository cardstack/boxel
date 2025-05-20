import { getField } from './index';
import type { CardDef } from 'https://cardstack.com/base/card-api';

export class NotLoaded extends Error {
  readonly isNotLoadedError: true = true;
  constructor(
    readonly instance: any,
    readonly reference: string | string[],
    readonly fieldName: string,
  ) {
    let message: string;
    let card = Reflect.getPrototypeOf(instance)!.constructor as typeof CardDef;
    let field = getField(card, fieldName);
    if (!field) {
      throw new Error(
        `The field '${fieldName} does not exist in card ${card.name}'`,
      );
    }
    if (Array.isArray(reference)) {
      message = `The field ${
        instance.constructor.name
      }.${fieldName} refers to the card instances in array ${JSON.stringify(
        reference,
      )} which are not loaded`;
    } else {
      message = `The field ${instance.constructor.name}.${fieldName} refers to the card instance ${reference} which is not loaded`;
    }
    super(message);
  }
}

export function isNotLoadedError(err: any): err is NotLoaded {
  return (
    err != null &&
    typeof err === 'object' &&
    err.isNotLoadedError === true &&
    'fieldName' in err &&
    'reference' in err &&
    'instance' in err
  );
}
