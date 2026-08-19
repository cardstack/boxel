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
    if (!this.validate(this.lastEditedValue)) {
      return;
    }
    // Submitting a valid URL commits the navigation, so the bar is done with
    // focus. Release it before navigating: the editor places its cursor in
    // the newly opened file at an unpredictable point during the load, and
    // it declines to grab focus away from a text-entry element that still
    // holds it. Blurring first guarantees the editor sees the bar as
    // relinquished no matter when that cursor placement fires.
    if (event.target instanceof HTMLElement) {
      event.target.blur();
    }
    await this.setURL(this.lastEditedValue);
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

  async setURL(newURL: string) {
    if (this.validate(this.lastEditedValue)) {
      if (this.setValue) {
        await this.setValue(newURL);
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
