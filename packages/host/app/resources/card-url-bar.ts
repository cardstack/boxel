import { Resource } from 'ember-resources';
import { tracked } from '@glimmer/tracking';

interface Args {
  named: {
    getValue: () => string | null; //getter of code path
    setValue: (val: URL) => void; //setter of code path
    resetLoadFileError: () => void;
    loadFileError: string | null;
  };
}

export default class CardURLBarResource extends Resource<Args> {
  @tracked _url: string | null = null; // Placeholder for last commited url
  @tracked _lastEditedValue: string | null = null; // Url while user is editing
  @tracked isEditing = false;

  modify(_positional: never[], named: Args['named']) {
    let { getValue, setValue, resetLoadFileError, loadFileError } = named;
    this._url = getValue();
    this.setValue = setValue;
    this.resetLoadFileError = resetLoadFileError;
    this.loadFileError = loadFileError;
  }

  get url() {
    if (this.isEditing) {
      return this._lastEditedValue;
    } else {
      return this._url;
    }
  }

  get isFocused() {
    return this.isEditing;
  }

  get showErrorMessage() {
    return !this.validate(this.url) || this.loadFileError;
  }

  get errorMessage() {
    if (!this.validate(this.url)) {
      return 'Not a valid URL';
    } else {
      return this.loadFileError;
    }
  }

  onKeyPress(event: KeyboardEvent) {
    if (event.key !== 'Enter' || !this._lastEditedValue) {
      return;
    }
    this.setURL(this._lastEditedValue);
  }

  onInputChange(newURL: string) {
    this.isEditing = true;
    this._lastEditedValue = newURL;
    this.resetLoadFileError();
  }

  onBlur() {
    if (this.validate(this._lastEditedValue)) {
      this._url = this.url;
    }
    this.isEditing = false;
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
    }
  }
}

export function cardURLBarResource(
  parent: object,
  args: () => Args['named'],
): CardURLBarResource {
  return CardURLBarResource.from(parent, () => ({
    named: args(),
  })) as unknown as CardURLBarResource;
}
