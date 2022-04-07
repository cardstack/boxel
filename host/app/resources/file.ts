import { Resource, useResource } from 'ember-resources';
import { tracked } from '@glimmer/tracking';
import { restartableTask } from 'ember-concurrency';
import { taskFor } from 'ember-concurrency-ts';

interface Args {
  named: { handle: FileSystemFileHandle | undefined };
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
  @tracked content: string | undefined;
  @tracked ready = false;

  constructor(owner: unknown, args: Args) {
    super(owner, args);
    this.handle = args.named.handle;
    this.read();
  }

  get name() {
    return this.handle?.name;
  }

  private async read() {
    if (this.handle) {
      let file = await this.handle.getFile();
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
  handle: () => FileSystemFileHandle | undefined
): FileResource {
  return useResource(parent, _FileResource, () => ({
    named: { handle: handle() },
  })) as FileResource;
}
