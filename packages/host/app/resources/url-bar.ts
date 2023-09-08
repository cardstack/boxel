import { Resource } from 'ember-resources';
import { tracked } from '@glimmer/tracking';

interface Args {
  named: {
    getValue: () => string | null;
    setValue: (val: URL) => void;
    setValueError?: string | null;
    resetValueError?: () => void;
  };
}

export default class URLBarResource extends Resource<Args> {
  @tracked _url: string | null = null; // Last placeholder URL
  @tracked _lastEditedValue: string | null = null; // URL user is editing
  @tracked isEditing = false;
  @tracked isFocused = false;

  modify(_positional: never[], named: Args['named']) {
    let { getValue, setValue, resetValueError, setValueError } = named;
    this._url = getValue();
    this.setValue = setValue;
    if (resetValueError) {
      this.resetValueError = resetValueError;
    }
    if (this.setValueError) {
      this.setValueError = setValueError;
    }
  }

  get url() {
    if (this.isEditing) {
      return this._lastEditedValue;
    } else {
      return this._url;
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
    this._url = this.url;
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
    if (this.validate(this._lastEditedValue)) {
      this.setValue(newURL);
      this._url = newURL;
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
