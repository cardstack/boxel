import { Resource } from 'ember-resources/core';
import { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';
import { restartableTask, TaskInstance } from 'ember-concurrency';
import { taskFor } from 'ember-concurrency-ts';
import { registerDestructor } from '@ember/destroyable';
import LoaderService from '../services/loader-service';
import log from 'loglevel';

interface Args {
  named: {
    url: string;
    content: string | undefined;
    lastModified: string | undefined;
    onStateChange?: (state: FileResource['state']) => void;
    polling: 'off' | undefined;
  };
}

export type FileResource =
  | {
      state: 'server-error';
      url: string;
      loading: TaskInstance<void> | null;
    }
  | {
      state: 'not-found';
      url: string;
      loading: TaskInstance<void> | null;
    }
  | {
      state: 'ready';
      content: string;
      name: string;
      url: string;
      loading: TaskInstance<void> | null;
      write(content: string, flushLoader?: true): void;
      close(): void;
    };

class _FileResource extends Resource<Args> {
  private interval: ReturnType<typeof setInterval> | undefined;
  private declare _url: string;
  private lastModified: string | undefined;
  private onStateChange?: ((state: FileResource['state']) => void) | undefined;
  @tracked content: string | undefined;
  @tracked state: FileResource['state'] = 'ready';
  @service declare loaderService: LoaderService;

  modify(_positional: never[], named: Args['named']) {
    let { url, content, lastModified, onStateChange, polling } = named;
    this._url = url;
    this.onStateChange = onStateChange;
    if (content !== undefined) {
      this.content = content;
      this.lastModified = lastModified;
    } else {
      // get the initial content if we haven't already been seeded with initial content
      taskFor(this.read).perform();
    }
    if (polling !== 'off') {
      this.interval = setInterval(() => taskFor(this.read).perform(), 1000);
      registerDestructor(this, () => clearInterval(this.interval!));
    } else if (this.interval) {
      clearInterval(this.interval);
    }
  }

  get url() {
    return this._url;
  }

  get name() {
    return this._url.split('/').pop()!;
  }

  get loading() {
    return taskFor(this.read).last;
  }

  close() {
    if (this.interval) {
      clearInterval(this.interval);
    }
  }

  @restartableTask private async read() {
    let prevState = this.state;
    let response = await this.loaderService.loader.fetch(this.url, {
      headers: {
        Accept: 'application/vnd.card+source',
      },
    });
    if (!response.ok) {
      log.error(
        `Could not get file ${this.url}, status ${response.status}: ${
          response.statusText
        } - ${await response.text()}`
      );
      if (response.status === 404) {
        this.state = 'not-found';
      } else {
        this.state = 'server-error';
      }
      if (this.onStateChange && this.state !== prevState) {
        this.onStateChange(this.state);
      }
      return;
    }
    let lastModified = response.headers.get('last-modified') || undefined;
    if (this.lastModified === lastModified) {
      return;
    }
    this.lastModified = lastModified;
    this.content = await response.text();
    this.state = 'ready';
    if (this.onStateChange && this.state !== prevState) {
      this.onStateChange(this.state);
    }
  }

  async write(content: string, flushLoader?: true) {
    await taskFor(this.doWrite).perform(content);
    if (flushLoader) {
      this.loaderService.reset();
    }
  }

  @restartableTask private async doWrite(content: string) {
    let response = await this.loaderService.loader.fetch(this.url, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.card+source',
      },
      body: content,
    });
    if (!response.ok) {
      log.error(
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
    this.lastModified = response.headers.get('last-modified') || undefined;
  }
}

export function file(parent: object, args: () => Args['named']): FileResource {
  return _FileResource.from(parent, () => ({
    named: args(),
  })) as unknown as FileResource;
}
