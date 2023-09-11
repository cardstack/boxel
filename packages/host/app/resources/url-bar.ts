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
  @tracked private value: string | null = null; // url string url
  @tracked private lastEditedValue: string | null = null; // url string url user when is editing
  @tracked isEditing = false;
  @tracked isFocused = false;

  setValue?: (val: string) => void;
  setValueError?: string | null;
  resetValueError?: () => void;

  modify(_positional: never[], named: Args['named']) {
    let { getValue, setValue, resetValueError, setValueError } = named;
    this.value = getValue();
    this.setValue = setValue;
    this.resetValueError = resetValueError;
    this.setValueError = setValueError;
  }

  get url() {
    if (this.isEditing) {
      return this.lastEditedValue;
    } else {
      return this.value;
    }
  }

  get showErrorMessage() {
    return !this.validate(this.url) || !!this.setValueError;
  }

  get errorMessage() {
    if (!this.validate(this.url)) {
      return 'Not a valid URL';
    } else {
      return (
        this.setValueError || 'An unknown error occured when setting the URL'
      );
    }
  }

  onKeyPress(event: KeyboardEvent) {
    if (event.key !== 'Enter' || !this.lastEditedValue) {
      return;
    }
    this.setURL(this.lastEditedValue);
  }

  onInput(newURL: string) {
    this.isEditing = true;
    this.lastEditedValue = newURL;
    this.resetValueError?.();
  }

  onFocus() {
    this.isFocused = true;
  }

  onBlur() {
    this.value = this.url;
    this.isEditing = false;
    this.isFocused = false;
  }

  validate(url: string | null) {
    if (url === null) {
      return false;
    }
    try {
      new URL(url);
      return true;
    } catch (e) {
      return false;
    }
  }

  setURL(newURL: string) {
    if (this.validate(this.lastEditedValue)) {
      if (this.setValue) {
        this.setValue(newURL);
      }
      this.value = newURL;
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
