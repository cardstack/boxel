import { Resource, useResource } from 'ember-resources';
import { tracked } from '@glimmer/tracking';
import { restartableTask } from 'ember-concurrency';
import { taskFor } from 'ember-concurrency-ts';
import { registerDestructor } from '@ember/destroyable';

interface Args {
  named: {
    path: string | undefined;
    handle: FileSystemDirectoryHandle | undefined;
  };
}

type FileResource =
  | {
      ready: false;
    }
  | {
      ready: true;
      content: string;
      name: string;
      write(content: string): void;
    };

class _FileResource extends Resource<Args> {
  private handle: FileSystemFileHandle | undefined;
  private lastModified: number | undefined;
  private interval: ReturnType<typeof setInterval>;
  @tracked content: string | undefined;
  @tracked ready = false;

  constructor(owner: unknown, args: Args) {
    super(owner, args);
    this.read(args.named.path, args.named.handle);
    this.interval = setInterval(
      () => this.read(args.named.path, args.named.handle),
      1000
    );
    registerDestructor(this, () => clearInterval(this.interval));
  }

  get name() {
    return this.handle?.name;
  }

  private async read(
    path: string | undefined,
    dirHandle: FileSystemDirectoryHandle | undefined
  ) {
    if (path && dirHandle) {
      let handle: FileSystemFileHandle | undefined;
      try {
        handle = await dirHandle.getFileHandle(path);
      } catch (err: unknown) {
        if ((err as DOMException).name === 'NotFoundError') {
          console.error(`${path} was not found in the local realm`);
        }
        throw err;
      }
      if (!handle) {
        throw new Error(
          `can't obtain file ${path} from the local realm, perhaps this is a directory?`
        );
      }

      this.handle = handle;
      let file = await this.handle.getFile();
      if (file.lastModified === this.lastModified) {
        return;
      }
      this.lastModified = file.lastModified;
      let reader = new FileReader();
      this.content = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsText(file);
      });
      this.ready = true;
    } else {
      this.content = undefined;
      this.ready = false;
    }
  }

  async write(content: string) {
    taskFor(this.doWrite).perform(content);
  }

  @restartableTask private async doWrite(content: string) {
    if (!this.handle) {
      throw new Error(`can't write to not ready FileResource`);
    }
    // TypeScript seems to lack types for the writable stream features
    let stream = await (this.handle as any).createWritable();
    await stream.write(content);
    await stream.close();
  }
}

export function file(
  parent: object,
  path: () => string | undefined,
  handle: () => FileSystemDirectoryHandle | undefined
): FileResource {
  return useResource(parent, _FileResource, () => ({
    named: { path: path(), handle: handle() },
  })) as FileResource;
}
