import { registerDestructor } from '@ember/destroyable';
import { tracked } from '@glimmer/tracking';

import { formatDistance } from 'date-fns';
import { Resource } from 'ember-modify-based-class-resource';

import type { Ready as ReadyFile } from '@cardstack/host/resources/file';

interface Args {
  named: { file: ReadyFile };
}

export const LAST_SAVED_JUST_NOW_THRESHOLD_MS = 60 * 1000;

export function formatLastSavedText(date: Date, now = Date.now()) {
  if (Math.abs(now - date.getTime()) < LAST_SAVED_JUST_NOW_THRESHOLD_MS) {
    return 'Last saved just now';
  }

  return `Last saved ${formatDistance(date, now, {
    addSuffix: true,
  })}`;
}

export class LastModifiedDateResource extends Resource<Args> {
  @tracked value: string | undefined;
  private refresh: number | undefined;

  modify(_positional: never[], named: Args['named']) {
    this.calculate(named.file);
    if (!this.refresh) {
      this.refresh = setInterval(
        () => this.calculate(named.file),
        10 * 1000,
      ) as unknown as number;
      registerDestructor(this, () => {
        clearInterval(this.refresh);
      });
    }
  }

  private calculate(file: ReadyFile) {
    if (file.lastModifiedAsDate != undefined) {
      this.value = formatLastSavedText(file.lastModifiedAsDate);
    } else {
      this.value = undefined;
    }
  }
}

export function lastModifiedDate(parent: object, file: () => ReadyFile) {
  return LastModifiedDateResource.from(parent, () => ({
    named: {
      file: file(),
    },
  }));
}
