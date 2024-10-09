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
  //Check the first line looks like a file path, then a colon, and finishes with (number:number)
  const lines = message.split('\n');
  const firstLine = lines[0];
  const filePathMatch = firstLine.match(/^(.+?):(.+?)\((\d+):(\d+)\)$/);
  console.log('filePathMatch', filePathMatch);
  console.log('firstLine', firstLine);
  let range: vscode.Range;
  if (filePathMatch) {
    console.log('filePathMatch', filePathMatch);
    const lineNumber = parseInt(filePathMatch[3]) - 1;
    const columnNumber = parseInt(filePathMatch[4]) - 1;
    range = new vscode.Range(
      lineNumber,
      columnNumber,
      lineNumber,
      columnNumber,
    );
  } else {
    range = new vscode.Range(0, 0, 0, 0);
  }

  const diagnostic = new vscode.Diagnostic(
    range,
    message,
    vscode.DiagnosticSeverity.Error, // Or Warning, Information, etc.
  );

  diagnostic.source = 'boxelrealm';

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
