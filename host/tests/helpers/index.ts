import { parse } from 'date-fns';
import { Realm } from '@cardstack/runtime-common';

export function cleanWhiteSpace(text: string) {
  return text.replace(/\s+/g, ' ').trim();
}

export function p(dateString: string): Date {
  return parse(dateString, 'yyyy-MM-dd', new Date());
}

export class TestRealm implements Realm {
  url = 'http://test-realm/';

  constructor(private files: Record<string, string | object>) {}

  async *eachFile(): AsyncGenerator<{ path: string; contents: string }, void> {
    for (let [path, contents] of Object.entries(this.files)) {
      if (typeof contents === 'string') {
        yield { path, contents };
      } else {
        yield { path, contents: JSON.stringify(contents) };
      }
    }
  }
}
