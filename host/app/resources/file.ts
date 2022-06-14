import { Resource, TaskInstance, useResource } from 'ember-resources';
import { tracked } from '@glimmer/tracking';
import { restartableTask } from 'ember-concurrency';
import { taskFor } from 'ember-concurrency-ts';
import { registerDestructor } from '@ember/destroyable';

interface Args {
  named: {
    url: string | undefined;
    content: string | undefined;
    lastModified: string | undefined;
  };
}

export type FileResource =
  | {
      state: 'not-ready';
    }
  | {
      state: 'not-found';
      path: string;
      loading: TaskInstance<void> | null;
    }
  | {
      state: 'ready';
      content: string;
      name: string;
      path: string;
      loading: TaskInstance<void> | null;
      write(content: string): void;
    };

class _FileResource extends Resource<Args> {
  private interval: ReturnType<typeof setInterval>;
  private _url: string | undefined;
  private lastModified: string | undefined;
  @tracked content: string | undefined;
  @tracked state = 'not-ready';

  constructor(owner: unknown, args: Args) {
    super(owner, args);
    this._url = args.named.url;
    if (args.named.content !== undefined) {
      this.state = 'ready';
      this.content = args.named.content;
      this.lastModified = args.named.lastModified;
    } else {
      // get the initial content if we haven't already been seeded with initial content
      taskFor(this.read).perform();
    }
    this.interval = setInterval(() => taskFor(this.read).perform(), 1000);
    registerDestructor(this, () => clearInterval(this.interval));
  }

  get url() {
    return this._url;
  }

  get path() {
    return this._url ? new URL(this._url).pathname : undefined;
  }

  get name() {
    return this.path ? this.path.split('/').pop()! : undefined;
  }

  get loading() {
    return taskFor(this.read).last;
  }

  @restartableTask private async read() {
    if (this.url) {
      let response: Response | undefined;
      try {
        response = await fetch(this.url, {
          headers: {
            Accept: 'application/vnd.card+source',
          },
        });
      } catch (err: unknown) {
        clearInterval(this.interval);
        throw err;
      }
      if (!response.ok) {
        clearInterval(this.interval);
        console.error(
          `Could not get file ${this.url}, status ${response.status}: ${
            response.statusText
          } - ${await response.text()}`
        );
        return;
      }
      let lastModified = response.headers.get('Last-Modified') || undefined;
      if (this.lastModified === lastModified) {
        return;
      }
      this.lastModified = lastModified;
      this.content = await response.text();
      this.state = 'ready';
    } else {
      this.content = undefined;
      this.state = 'not-ready';
    }
  }

  async write(content: string) {
    taskFor(this.doWrite).perform(content);
  }

  @restartableTask private async doWrite(this: _FileResource, content: string) {
    if (!this._url) {
      throw new Error(`cannot write file because we ahve no URL`);
    }

    let response = await fetch(this._url, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.card+source',
      },
      body: content,
    });
    if (!response.ok) {
      console.error(
        `Could not write file ${this.url}, status ${response.status}: ${
          response.statusText
        } - ${await response.text()}`
      );
      return;
    }
    if (this.state === 'not-found') {
      // TODO think about the "unauthorized" scenario
      throw new Error(
        'this should be impossible--we are creating the specified path'
      );
    }

    this.content = content;
    this.lastModified = response.headers.get('Last-Modified') || undefined;
  }
}

export function file(
  parent: object,
  url: () => string | undefined,
  content: () => string | undefined,
  lastModified: () => string | undefined
): FileResource {
  return useResource(parent, _FileResource, () => ({
    named: { url: url(), content: content(), lastModified: lastModified() },
  })) as FileResource;
}
