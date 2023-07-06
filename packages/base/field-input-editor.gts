import { tracked } from '@glimmer/tracking';
import { serializePrimitive } from './card-api';

export type DeserializedResult<T> = {
  value: T | null;
  errorMessage?: string;
};
// only for primitive fields
export class FieldInputEditor<T> {
  constructor(
    private getValue: () => T | null,
    private setValue: (val: T | null | undefined) => void,
    private serialize: (
      val: T | null
    ) => string | undefined = serializePrimitive,
    private deserialize: (value: string) => DeserializedResult<T>
  ) {}
  @tracked lastEditingValue: string | undefined;
  @tracked error: string | undefined;

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
      return this.error;
    }
    return;
  }

  parseInput = async (inputVal: string) => {
    let deserialized = this.deserialize(inputVal);
    this.setValue(deserialized.value);
    this.error = deserialized.errorMessage;
    this.lastEditingValue = inputVal;
  };
}
