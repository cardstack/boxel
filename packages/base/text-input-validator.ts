import { tracked } from '@glimmer/tracking';

export class TextInputValidator<T> {
  private getValue: () => T | null;
  private setValue: (val: T | null | undefined) => void;
  private deserialize: (inputValue: string | null) => T | null;
  private serialize: (val: T | null) => string | undefined;
  private validate: (val: string) => string | null;

  constructor(
    getValue: () => T | null,
    setValue: (val: T | null | undefined) => void,
    deserialize: (inputValue: string | null) => T | null,
    serialize: (val: T | null) => string | undefined = (v) => String(v),
    validate: (val: string) => string | null = () => null,
  ) {
    this.getValue = getValue;
    this.setValue = setValue;
    this.deserialize = deserialize;
    this.serialize = serialize;
    this.validate = validate;
  }

  private lastEditedInputValue: string | undefined;
  @tracked errorMessage: string | undefined;

  get asString(): string {
    if (this.lastEditedInputValue != undefined) {
      return this.lastEditedInputValue;
    }
    let modelValue = this.getValue();
    return this.serialize(modelValue) ?? '';
  }

  get isInvalid() {
    return this.errorMessage != null;
  }

  onInput = async (inputVal: string) => {
    this.lastEditedInputValue = inputVal;

    let errorMessage = this.validate(inputVal);

    if (errorMessage) {
      this.errorMessage = errorMessage;
    } else {
      this.errorMessage = undefined;
      this.setValue(this.deserialize(inputVal));
      this.lastEditedInputValue = undefined;
    }
  };
}
