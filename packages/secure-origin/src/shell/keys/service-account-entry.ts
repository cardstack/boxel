import { trackedObject } from '@ember/reactive/collections';

import type { KeyValue, ServiceAccountDetails } from './context.ts';

// What is being entered for a Google service account: its JSON key file, read
// from disk in this window, the user to act as and the scopes. The page reads
// the file only to say which service account it holds and to refuse a file
// that isn't one before anything is sent; the realm server checks it again.
// The file's text stays in this object until the key is saved or the entry
// is cleared.
export class ServiceAccountEntry {
  private state = trackedObject({
    fileName: undefined as string | undefined,
    clientEmail: undefined as string | undefined,
    fileProblem: undefined as string | undefined,
    keyFile: undefined as string | undefined,
    subject: '',
    scopes: '',
  });

  get fileName() {
    return this.state.fileName;
  }
  get clientEmail() {
    return this.state.clientEmail;
  }
  get fileProblem() {
    return this.state.fileProblem;
  }
  get subject() {
    return this.state.subject;
  }
  set subject(value: string) {
    this.state.subject = value;
  }
  get scopes() {
    return this.state.scopes;
  }
  set scopes(value: string) {
    this.state.scopes = value;
  }

  async readFile(file: File | undefined): Promise<void> {
    this.state.keyFile = undefined;
    this.state.clientEmail = undefined;
    this.state.fileProblem = undefined;
    this.state.fileName = file?.name;
    if (!file) {
      return;
    }
    let text: string;
    try {
      text = await file.text();
    } catch {
      this.state.fileProblem = 'The file couldn’t be read.';
      return;
    }
    this.readText(text, file.name);
  }

  // A key file's text, as chosen from disk or pasted where a plain key goes.
  readText(text: string, source: string): void {
    this.state.keyFile = undefined;
    this.state.clientEmail = undefined;
    this.state.fileProblem = undefined;
    this.state.fileName = source;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      this.state.fileProblem =
        'This isn’t a JSON key file. Choose the JSON key file Google gave you for the service account.';
      return;
    }
    let { type, client_email } = (parsed ?? {}) as Record<string, unknown>;
    if (type !== 'service_account' || typeof client_email !== 'string') {
      this.state.fileProblem =
        'This isn’t a service account key file. Choose the JSON key file Google gave you for the service account.';
      return;
    }
    this.state.keyFile = text;
    this.state.clientEmail = client_email;
  }

  // The scopes as typed: separated by spaces, commas or line breaks.
  get scopeList(): string[] {
    return this.state.scopes.split(/[\s,]+/).filter(Boolean);
  }

  get isComplete(): boolean {
    return Boolean(this.state.keyFile) && this.scopeList.length > 0;
  }

  get value(): KeyValue | undefined {
    let keyFile = this.state.keyFile;
    if (!keyFile || this.scopeList.length === 0) {
      return undefined;
    }
    return {
      kind: 'google-service-account',
      value: keyFile,
      subject: this.state.subject.trim(),
      scopes: this.scopeList,
    };
  }

  // A replace starts from the user the key acts as and the scopes it asks
  // for now, so leaving them as they are keeps them. Only those two are set:
  // the key file is always chosen anew, and one already chosen stays. The
  // scopes go one per line, so the field shows each of them whole.
  prefill({ subject, scopes }: ServiceAccountDetails): void {
    this.state.subject = subject ?? '';
    this.state.scopes = scopes.join('\n');
  }

  clear(): void {
    this.state.keyFile = undefined;
    this.state.fileName = undefined;
    this.state.clientEmail = undefined;
    this.state.fileProblem = undefined;
    this.state.subject = '';
    this.state.scopes = '';
  }
}
