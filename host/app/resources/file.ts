import { Resource, useResource } from 'ember-resources';
import { tracked } from '@glimmer/tracking';
import { restartableTask } from 'ember-concurrency';
import { taskFor } from 'ember-concurrency-ts';
import { registerDestructor } from '@ember/destroyable';
import { traverse } from '@cardstack/runtime-common';

const executableExtensions = ['.js', '.gjs', '.ts', '.gts'];
interface Args {
  named: {
    path: string | undefined;
    handle: FileSystemDirectoryHandle | undefined;
    onRedirect: (newPath: string) => void;
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
      path: string;
      write(content: string): void;
    };

class _FileResource extends Resource<Args> {
  private handle: FileSystemFileHandle | undefined;
  private lastModified: number | undefined;
  private interval: ReturnType<typeof setInterval>;
  private _path: string | undefined;
  @tracked content: string | undefined;
  @tracked ready = false;

  constructor(owner: unknown, args: Args) {
    super(owner, args);
    this.read(args.named.path, args.named.handle, args.named.onRedirect);
    this.interval = setInterval(
      () =>
        this.read(args.named.path, args.named.handle, args.named.onRedirect),
      1000
    );
    registerDestructor(this, () => clearInterval(this.interval));
  }

  get path() {
    return this._path;
  }

  get name() {
    return this.handle?.name;
  }

  private async read(
    path: string | undefined,
    dirHandle: FileSystemDirectoryHandle | undefined,
    onRedirect: (newPath: string) => void
  ) {
    if (path && dirHandle) {
      let { handle: subdir, filename } = await traverse(dirHandle, path);
      let handle: FileSystemFileHandle | undefined;
      try {
        handle = await subdir.getFileHandle(filename);
      } catch (err: unknown) {
        if ((err as DOMException).name !== 'NotFoundError') {
          throw err;
        }
        if (!filename.includes('.')) {
          // perform some basic module resolution
          for (let extension of executableExtensions) {
            try {
              console.info(
                `retrying with ${filename + extension} in the local realm`
              );
              handle = await subdir.getFileHandle(filename + extension);
            } catch (innerErr: unknown) {
              if ((err as DOMException).name !== 'NotFoundError') {
                throw err;
              }
            }
          }
          if (handle) {
            let pathSegments = path.split('/');
            pathSegments.pop();
            pathSegments.push(handle.name);
            path = pathSegments.join('/');
            onRedirect(path);
          }
        }
      }
      if (!handle) {
        throw new Error(`can't obtain file ${path} from the local realm`);
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
      this._path = path;
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
  handle: () => FileSystemDirectoryHandle | undefined,
  onRedirect: () => (newPath: string) => void
): FileResource {
  return useResource(parent, _FileResource, () => ({
    named: { path: path(), handle: handle(), onRedirect: onRedirect() },
  })) as FileResource;
}
