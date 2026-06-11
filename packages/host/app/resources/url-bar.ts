import { tracked } from '@glimmer/tracking';

import { Resource } from 'ember-modify-based-class-resource';

interface Args {
  named: {
    getValue: () => string | null;
    setValue: (val: string) => Promise<void>;
    setValueError: string | null;
    resetValueError: () => void;
  };
}

export default class URLBarResource extends Resource<Args> {
  @tracked private value: string | null = null; // url string url
  @tracked private lastEditedValue: string | null = null; // url string url user when is editing
  @tracked isEditing = false;
  @tracked isFocused = false;

  setValue?: (val: string) => Promise<void>;
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

  get errorMessage() {
    if (!this.url) {
      return;
    }
    if (this.setValueError) {
      return this.setValueError;
    } else if (!this.validate(this.url)) {
      return 'Not a valid URL';
    }
    return;
  }

  async onKeyPress(event: KeyboardEvent) {
    if (event.key !== 'Enter' || !this.lastEditedValue) {
      return;
    }
    let submitted = await this.setURL(this.lastEditedValue);
    // Submitting the URL commits the navigation, so the bar is done with
    // focus; releasing it here lets the editor take focus when it places
    // the cursor in the newly opened file (the editor declines to grab
    // focus away from a text-entry element that still holds it).
    if (submitted && event.target instanceof HTMLElement) {
      event.target.blur();
    }
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
    // Capture currently typed value before mutating tracked state to avoid
    // reading from `url`, which depends on `isEditing`, while we are about to
    // update `isEditing`.
    let updatedValue = this.lastEditedValue ?? this.value;

    this.isEditing = false;
    this.isFocused = false;
    this.value = updatedValue;
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

  async setURL(newURL: string): Promise<boolean> {
    if (!this.validate(this.lastEditedValue)) {
      return false;
    }
    if (this.setValue) {
      await this.setValue(newURL);
    }
    this.value = newURL;
    this.isEditing = false;
    return true;
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
