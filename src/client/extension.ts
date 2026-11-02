import * as path from 'node:path';
import * as vscode from 'vscode';
import { LanguageClient, TransportKind, type LanguageClientOptions, type ServerOptions } from 'vscode-languageclient/node';
import { MappingContextView } from './contextView';
import { OpenFhirFeature } from './openfhir/feature';
import { GRAMMAR_VERSIONS, mappingTemplate, type GrammarVersion, type MappingKind } from './templates';

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
      // mapping files, operational templates, ADL archetypes and StructureDefinitions
      fileEvents: vscode.workspace.createFileSystemWatcher('**/*.{yml,yaml,opt,adl,json}'),
    },
  };
  // `fhirconnect.isMapping` limits the archetype commands to mapping files
  const updateContext = (editor: vscode.TextEditor | undefined) =>
    void vscode.commands.executeCommand('setContext', 'fhirconnect.isMapping', !!editor && /^grammar:\s*["']?FHIRConnect\//m.test(editor.document.getText()));
  updateContext(vscode.window.activeTextEditor);
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(updateContext),
    vscode.workspace.onDidSaveTextDocument((d) => d === vscode.window.activeTextEditor?.document && updateContext(vscode.window.activeTextEditor)),
  );
  client = new LanguageClient('fhirconnect', 'FHIRConnect', serverOptions, clientOptions);
  context.subscriptions.push(
    vscode.commands.registerCommand('fhirconnect.newMapping', newMapping),
    vscode.commands.registerTextEditorCommand('fhirconnect.goToArchetype', (editor) => goToArchetype(editor, 'goto')),
    vscode.commands.registerTextEditorCommand('fhirconnect.peekArchetype', (editor) => goToArchetype(editor, 'peek')),
  );
  await client.start();
  new MappingContextView(client).register(context);
  new OpenFhirFeature(context, client).register();
}

export async function deactivate(): Promise<void> {
  await client?.stop();
}

/** Opens the ADL archetype at the node the openEHR path under the cursor stands for. */
async function goToArchetype(editor: vscode.TextEditor, mode: 'goto' | 'peek'): Promise<void> {
  if (!client) return;
  const position = editor.selection.active;
  const result = await client.sendRequest<{ uri: string; range: { start: { line: number; character: number } } }[]>('fhirconnect/archetypeDefinition', {
    textDocument: { uri: editor.document.uri.toString() },
    position: { line: position.line, character: position.character },
  });
  if (result.length === 0) {
    void vscode.window.showInformationMessage(
      'No ADL archetype found for this position. Place the cursor on an openEHR path or on spec.openEhrConfig.archetype, and keep the .adl files in the workspace.',
    );
    return;
  }
  const locations = result.map((l) => {
    const start = new vscode.Position(l.range.start.line, l.range.start.character);
    return new vscode.Location(vscode.Uri.parse(l.uri), new vscode.Range(start, start));
  });
  await vscode.commands.executeCommand('editor.action.goToLocations', editor.document.uri, position, locations, mode, 'No ADL archetype found');
}

async function newMapping(): Promise<void> {
  const kinds: (vscode.QuickPickItem & { mappingKind: MappingKind })[] = [
    { label: 'Model mapping', description: 'maps an openEHR archetype to a FHIR resource', mappingKind: 'model' },
    { label: 'Extension mapping', description: 'adds to, appends to or overwrites a model mapping', mappingKind: 'extension' },
    { label: 'Context mapping', description: 'combines mappings for a template and a profile', mappingKind: 'context' },
  ];
  const picked = await vscode.window.showQuickPick(kinds, { title: 'New FHIRConnect mapping', placeHolder: 'Kind of mapping file' });
  if (!picked) return;
  const versions: (vscode.QuickPickItem & { version: GrammarVersion })[] = GRAMMAR_VERSIONS.map((version) => ({
    label: `v${version}`,
    description: version === '1.0.0' ? 'the version of the specification and of the current mapping library' : 'the version the openFHIR engine runs',
    version,
  }));
  const grammar = await vscode.window.showQuickPick(versions, { title: 'New FHIRConnect mapping', placeHolder: 'Grammar version' });
  if (!grammar) return;
  const name = await vscode.window.showInputBox({
    title: 'New FHIRConnect mapping',
    prompt: picked.mappingKind === 'model' ? 'Mapping name, e.g. EVALUATION.problem_diagnosis.v1' : 'Mapping name',
    validateInput: (value) => (value.trim() ? undefined : 'Enter a name'),
  });
  if (!name) return;
  const document = await vscode.workspace.openTextDocument({ language: 'yaml', content: '' });
  const editor = await vscode.window.showTextDocument(document);
  await editor.insertSnippet(new vscode.SnippetString(mappingTemplate(picked.mappingKind, name.trim(), grammar.version)));
}
