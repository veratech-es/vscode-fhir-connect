import * as path from 'node:path';
import * as vscode from 'vscode';
import { LanguageClient, TransportKind, type LanguageClientOptions, type ServerOptions } from 'vscode-languageclient/node';
import { mappingTemplate, type MappingKind } from './templates';

let client: LanguageClient | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const serverModule = context.asAbsolutePath(path.join('dist', 'server.js'));
  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: { module: serverModule, transport: TransportKind.ipc, options: { execArgv: ['--nolazy', '--inspect=6009'] } },
  };
  const clientOptions: LanguageClientOptions = {
    // mapping files are plain YAML; the server only answers for files that start with `grammar: FHIRConnect/`
    documentSelector: [
      { scheme: 'file', language: 'yaml' },
      { scheme: 'untitled', language: 'yaml' },
    ],
    synchronize: {
      configurationSection: 'fhirconnect',
      // mapping files, operational templates and StructureDefinitions
      fileEvents: vscode.workspace.createFileSystemWatcher('**/*.{yml,yaml,opt,json}'),
    },
  };
  client = new LanguageClient('fhirconnect', 'FHIRConnect', serverOptions, clientOptions);
  context.subscriptions.push(vscode.commands.registerCommand('fhirconnect.newMapping', newMapping));
  await client.start();
}

export async function deactivate(): Promise<void> {
  await client?.stop();
}

async function newMapping(): Promise<void> {
  const kinds: (vscode.QuickPickItem & { mappingKind: MappingKind })[] = [
    { label: 'Model mapping', description: 'maps an openEHR archetype to a FHIR resource', mappingKind: 'model' },
    { label: 'Extension mapping', description: 'adds to, appends to or overwrites a model mapping', mappingKind: 'extension' },
    { label: 'Context mapping', description: 'combines mappings for a template and a profile', mappingKind: 'context' },
  ];
  const picked = await vscode.window.showQuickPick(kinds, { title: 'New FHIRConnect mapping', placeHolder: 'Kind of mapping file' });
  if (!picked) return;
  const name = await vscode.window.showInputBox({
    title: 'New FHIRConnect mapping',
    prompt: picked.mappingKind === 'model' ? 'Mapping name, e.g. EVALUATION.problem_diagnosis.v1' : 'Mapping name',
    validateInput: (value) => (value.trim() ? undefined : 'Enter a name'),
  });
  if (!name) return;
  const document = await vscode.workspace.openTextDocument({ language: 'yaml', content: '' });
  const editor = await vscode.window.showTextDocument(document);
  await editor.insertSnippet(new vscode.SnippetString(mappingTemplate(picked.mappingKind, name.trim())));
}
