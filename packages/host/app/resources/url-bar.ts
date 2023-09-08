import { Resource } from 'ember-resources';
import { tracked } from '@glimmer/tracking';

interface Args {
  named: {
    getValue: () => string | null;
    setValue?: (val: string) => void;
    setValueError?: string | null;
    resetValueError?: () => void;
  };
}

export default class URLBarResource extends Resource<Args> {
  @tracked _value: string | null = null; // url string value
  @tracked _lastEditedValue: string | null = null; // url string value user when is editing
  @tracked isEditing = false;
  @tracked isFocused = false;

  setValue?: (val: string) => void;
  setValueError?: string | null;
  resetValueError?: () => void;

  modify(_positional: never[], named: Args['named']) {
    let { getValue, setValue, resetValueError, setValueError } = named;
    this._value = getValue();
    this.setValue = setValue;
    this.resetValueError = resetValueError;
    this.setValueError = setValueError;
  }

  get value() {
    if (this.isEditing) {
      return this._lastEditedValue;
    } else {
      return this._value;
    }
  }

  get showErrorMessage() {
    return !this.validate(this.value) || !!this.setValueError;
  }

  get errorMessage() {
    if (!this.validate(this.value)) {
      return 'Not a valid URL';
    } else {
      return (
        this.setValueError || 'An unknown error occured when setting the URL'
      );
    }
  }

  onKeyPress(event: KeyboardEvent) {
    if (event.key !== 'Enter' || !this._lastEditedValue) {
      return;
    }
    this.setURL(this._lastEditedValue);
  }

  onInput(newURL: string) {
    this.isEditing = true;
    this._lastEditedValue = newURL;
    this.resetValueError?.();
  }

  onFocus() {
    this.isFocused = true;
  }

  onBlur() {
    this._value = this.value;
    this.isEditing = false;
    this.isFocused = false;
  }

  validate(value: string | null) {
    if (value === null) {
      return false;
    }
    try {
      new URL(value);
      return true;
    } catch (e) {
      return false;
    }
  }

  setURL(newURL: string) {
    if (this.validate(this._lastEditedValue)) {
      if (this.setValue) {
        this.setValue(newURL);
      }
      this._value = newURL;
      this.isEditing = false;
    }
  }
}

export function urlBarResource(
  parent: object,
  args: () => Args['named'],
): URLBarResource {
  return URLBarResource.from(parent, () => ({
    named: args(),
  })) as unknown as URLBarResource;
}
