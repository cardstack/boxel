import { initSharedState } from '../shared-state';
import { type BaseDef } from './-base-def';
import { isCardOrField } from './-type-utils';
import { getFields, peekAtField } from './-fields/storage';

type CardChangeSubscriber = (
  instance: BaseDef,
  fieldName: string,
  fieldValue: any,
) => void;

const subscribers = initSharedState(
  'subscribers',
  () => new WeakMap<BaseDef, Set<CardChangeSubscriber>>(),
);

export function subscribeToChanges(
  fieldOrCard: BaseDef,
  subscriber: CardChangeSubscriber,
) {
  let changeSubscribers = subscribers.get(fieldOrCard);
  if (changeSubscribers && changeSubscribers.has(subscriber)) {
    return;
  }

  if (!changeSubscribers) {
    changeSubscribers = new Set();
    subscribers.set(fieldOrCard, changeSubscribers);
  }

  changeSubscribers.add(subscriber);

  let fields = getFields(fieldOrCard, {
    usedFieldsOnly: true,
    includeComputeds: false,
  });
  Object.keys(fields).forEach((fieldName) => {
    let value = peekAtField(fieldOrCard, fieldName);
    if (isCardOrField(value)) {
      subscribeToChanges(value, subscriber);
    }
  });
}

export function unsubscribeFromChanges(
  fieldOrCard: BaseDef,
  subscriber: CardChangeSubscriber,
) {
  let changeSubscribers = subscribers.get(fieldOrCard);
  if (!changeSubscribers) {
    return;
  }
  changeSubscribers.delete(subscriber);

  let fields = getFields(fieldOrCard, {
    usedFieldsOnly: true,
    includeComputeds: false,
  });
  Object.keys(fields).forEach((fieldName) => {
    let value = peekAtField(fieldOrCard, fieldName);
    if (isCardOrField(value)) {
      unsubscribeFromChanges(value, subscriber);
    }
  });
}

export function notifySubscribers(
  instance: BaseDef,
  fieldName: string,
  value: any,
) {
  let changeSubscribers = subscribers.get(instance);
  if (changeSubscribers) {
    for (let subscriber of changeSubscribers) {
      subscriber(instance, fieldName, value);
    }
  }
}

export function migrateSubscribers(
  oldFieldOrCard: BaseDef,
  newFieldOrCard: BaseDef,
) {
  let changeSubscribers = subscribers.get(oldFieldOrCard);
  if (changeSubscribers) {
    changeSubscribers.forEach((changeSubscriber) =>
      subscribeToChanges(newFieldOrCard, changeSubscriber),
    );
    changeSubscribers.forEach((changeSubscriber) =>
      unsubscribeFromChanges(oldFieldOrCard, changeSubscriber),
    );
  }
}
