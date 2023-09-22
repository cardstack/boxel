import { Resource } from 'ember-resources';
import { tracked } from '@glimmer/tracking';
import { formatDistanceToNow } from 'date-fns';
import { Ready as ReadyFile } from '@cardstack/host/resources/file';
import { registerDestructor } from '@ember/destroyable';

interface Args {
  named: { file: ReadyFile };
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
      let date = file.lastModifiedAsDate;
      if (Date.now() - date.getTime() < 10 * 1000) {
        this.value = 'Last saved just now';
      } else {
        this.value = `Last saved ${formatDistanceToNow(date, {
          addSuffix: true,
        })}`;
      }
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
