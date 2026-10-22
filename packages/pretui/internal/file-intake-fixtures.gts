// Pretui — fixtures shared by the file-intake usage pages.
import type { ScreenableFile } from './file-intake';

export 
/** What a demo keeps about a file. Holding a plain record rather than the
 * File itself keeps the rendered list stable and makes it obvious that the
 * caller receives real, inspectable data. */
interface TakenFile {
  name: string;
  type: string;
  size: number;
}

export 
function record(list: readonly ScreenableFile[]): TakenFile[] {
  return list.map((f) => ({ name: f.name, type: f.type, size: f.size }));
}
