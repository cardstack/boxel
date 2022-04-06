import { Resource, useResource } from 'ember-resources';
import { tracked } from '@glimmer/tracking';

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
}

export function file(
  parent: object,
  handle: () => FileSystemFileHandle | undefined
): FileResource {
  return useResource(parent, _FileResource, () => ({
    named: { handle: handle() },
  })) as FileResource;
}
