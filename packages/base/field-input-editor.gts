import { tracked } from '@glimmer/tracking';
import { serializePrimitive, deserializePrimitive } from './card-api';

// only for primitive fields
export class FieldInputEditor<T> {
  constructor(
    private getValue: () => T | null,
    private setValue: (val: T | null | undefined) => void,
    private serialize: (
      val: T | null
    ) => string | undefined = serializePrimitive,
    private deserialize: (
      value: string
    ) => T | null | undefined = deserializePrimitive,
    private errorMessageIfInvalid: string = 'Not a valid field input'
  ) {}
  @tracked lastEditingValue: string | undefined;

  get current(): string {
    let serialized = this.serialize(this.getValue());
    if (serialized != null && this.lastEditingValue !== serialized) {
      return serialized;
    }
    return this.lastEditingValue || '';
  }

  get isInvalid() {
    return this.current.length > 0 && this.getValue() == null;
  }

  get errorMessage(): string | undefined {
    if (this.isInvalid) {
      return this.errorMessageIfInvalid;
    }
    return;
  }

  parseInput = async (inputVal: string) => {
    let deserializedValue = this.deserialize(inputVal);
    this.setValue(deserializedValue);
    this.lastEditingValue = inputVal;
  };
}
