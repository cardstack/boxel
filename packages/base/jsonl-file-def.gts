import FileJsonIcon from '@cardstack/boxel-icons/file-json';
import StringField from './string';
import { bxl, operation, type OperationDeclaration } from './operations';
import { TextFileDef } from './text-file-def';

// A `.jsonl` file: JSON Lines, one JSON value per line.
//
// Unlike a `.json` document, a JSON Lines file stays well formed when a line
// is added to its end, which is what makes it an append-only record a program
// can read back entry by entry. It is read and rendered as text — the lines
// are the structure — so this inherits `TextFileDef`'s extraction and
// rendering whole.
export class JSONLFile extends TextFileDef {
  static displayName = 'JSON Lines';
  static icon = FileJsonIcon;
  static acceptTypes = '.jsonl,application/jsonl';
  static textExtensions: readonly string[] = ['.jsonl'];
  static fileKind = 'JSON Lines';

  // The caller says what happened. The realm says when, and who.
  //
  // The entry is composed by the `input` program, so the timestamp and the
  // authenticated actor are stamped where a caller cannot reach them, and a
  // `line` in the payload is overwritten rather than honoured. `tojson`
  // serializes the entry onto one line, escaping any line break inside
  // `what`, so every call appends exactly one parseable entry.
  //
  // `. +` merges into the payload rather than replacing it, which is the form
  // that leaves the declared params in place beside the line it adds.
  @operation static record = {
    base: 'appendLine',
    params: { what: StringField },
    input: bxl`. + { line: ({ at: TEXT(NOW(); "yyyy-mm-dd hh:mm:ss"), actor: actor(), what: params("what") } | tojson) }`,
  } satisfies OperationDeclaration;
}

export default JSONLFile;
