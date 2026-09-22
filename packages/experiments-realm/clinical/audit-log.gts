import StringField from '@cardstack/base/string';
import {
  bxl,
  operation,
  type OperationDeclaration,
} from '@cardstack/base/operations';
import { TextFileDef } from '@cardstack/base/text-file-def';

// The clinical audit log.
//
// A stored file's operations are the ones its class declares, and its class is
// the realm's to say: the `fileTypes` map in this realm's `realm.json` binds
// the audit log's extension to this type. Without that binding the file would
// be base's `TextFileDef`, whose only writes are the base `update` and
// `appendLine`, and the declaration below would lower, index, and never be
// reached by name.
export class AuditLog extends TextFileDef {
  static displayName = 'Audit Log';
  // What the file chooser offers when someone links a log to a record.
  // `TextFileDef` accepts `.txt`/`.text`, which are the extensions it is bound
  // to by default — this realm binds `.log` instead, so inheriting that list
  // would leave the picker unable to see the very files this type is for.
  static acceptTypes = '.log,text/plain';

  // The caller says what happened. The realm says when, and who.
  //
  // An `appendLine` usually declares a `line` param, which makes the whole
  // line the caller's to write — including the part naming who wrote it. An
  // `input` program is the other spelling: it *produces* the line, so the
  // timestamp and the authenticated actor are composed where a caller cannot
  // reach them. That is the difference between a log the caller writes and a
  // log the realm keeps.
  //
  // `. +` merges into the payload rather than replacing it, which is the form
  // that leaves the declared params in place beside the line it adds.
  //
  // `NOW()` answers an Excel serial rather than a timestamp, so it is
  // formatted here; unformatted it would append a number like `46023.518`.
  @operation static record = {
    base: 'appendLine',
    params: { what: StringField },
    input: bxl`. + { line: (TEXT(NOW(); "yyyy-mm-dd hh:mm:ss") + " " + actor() + " " + params("what")) }`,
  } satisfies OperationDeclaration;
}
