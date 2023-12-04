import { tracked } from '@glimmer/tracking';

export class TextInputValidator<T> {
  constructor(
    private getValue: () => T | null,
    private setValue: (val: T | null | undefined) => void,
    private deserialize: (inputValue: string | null) => T | null,
    private serialize: (val: T | null) => string | undefined = (v) => String(v),
    private validate: (val: string) => string | null = () => null,
  ) {}

  @tracked private lastEditedInputValue: string | undefined;
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
