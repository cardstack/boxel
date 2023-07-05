import { tracked } from '@glimmer/tracking';

export class FieldInputEditor<T> {
  constructor(
    private getValue: () => T | null,
    private setValue: (val: T | null | undefined) => void,
    private serialize: (val: T | null) => string | undefined,
    private deserialize: (value: string) => T | null | undefined
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
      return 'Not a valid field input';
    }
    return;
  }

  parseInput = async (inputVal: string) => {
    let deserializedValue = this.deserialize(inputVal);
    this.setValue(deserializedValue);
    this.lastEditingValue = inputVal;
  };
}
