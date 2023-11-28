import { tracked } from '@glimmer/tracking';

export class TextInputFilter<T> {
  constructor(
    private getValue: () => T | null,
    private setValue: (val: T | null | undefined) => void,
    private deserialize: (inputValue: string | null | undefined) => T | null,
    private serialize: (val: T) => string = (v) => String(v),
    private validate: (val: string) => string | null = () => null,
  ) {}

  @tracked private lastEditedInputValue: string | undefined;
  @tracked errorMessage: string | undefined;

  get asString(): string {
    let modelValue = this.getValue();
    if (modelValue != null) {
      return this.serialize(modelValue);
    }
    return this.lastEditedInputValue || '';
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
    }
  };
}
