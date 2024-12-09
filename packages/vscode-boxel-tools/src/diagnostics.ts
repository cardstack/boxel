import * as vscode from 'vscode';
import { RealmFS } from './file-system-provider';

async function getErrorMessagesForFile(
  fileUri: vscode.Uri,
  realmFs: RealmFS,
): Promise<string | undefined> {
  const file = await realmFs.readRawTextFile(fileUri);
  // We only care when there is an error code, ignore successful requests
  if (file.success) {
    return undefined;
  }
  return file.body;
}

function extractErrorsFromMessage(message: string): vscode.Diagnostic[] {
  const diagnostics: vscode.Diagnostic[] = [];
  // Start with a default range
  let lineNumber = 1;
  let columnNumber = 1;

  //Check the first line looks like a file path, then a colon, and finishes with (number:number)
  const lines = message.split('\n');
  const firstLine = lines[0];
  const filePathMatch = firstLine.match(/^(.+?):(.+?)\((\d+):(\d+)\)$/);

  if (filePathMatch && filePathMatch.length >= 5) {
    // try and parse the line and column numbers, defaulting to 1 if they don't parse
    // They should as the regex matches \d+:\d+
    lineNumber = parseInt(filePathMatch[3]) || 1;
    columnNumber = parseInt(filePathMatch[4]) || 1;
  }

  const range = new vscode.Range(
    lineNumber - 1,
    columnNumber - 1,
    lineNumber - 1,
    columnNumber - 1,
  );

  const diagnostic = new vscode.Diagnostic(
    range,
    message,
    vscode.DiagnosticSeverity.Error, // Or Warning, Information, etc.
  );

  diagnostic.source = 'boxel-tools';

  diagnostics.push(diagnostic);

  return diagnostics;
}

export function updateDiagnostics(
  document: vscode.TextDocument,
  diagnosticCollection: vscode.DiagnosticCollection,
  realmFs: RealmFS,
): void {
  getErrorMessagesForFile(document.uri, realmFs)
    .then((apiErrors) => {
      if (apiErrors) {
        const diagnostics = extractErrorsFromMessage(apiErrors);
        diagnosticCollection.set(document.uri, diagnostics);
      } else {
        diagnosticCollection.delete(document.uri);
      }
    })
    .catch((error) => {
      console.error('Failed to fetch errors:', error);
      diagnosticCollection.delete(document.uri); // Clear diagnostics on error
    });
}
