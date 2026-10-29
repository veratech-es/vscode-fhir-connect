import { readFile } from 'node:fs/promises';
import {
  createConnection,
  DiagnosticSeverity,
  FileChangeType,
  ProposedFeatures,
  ResponseError,
  TextDocuments,
  TextDocumentSyncKind,
  type Diagnostic,
  type Location as LspLocation,
  type TextEdit,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';
import { complete, TRIGGER_CHARACTERS, type NameProvider } from './completion';
import { parseFcDocument, type FcDocument } from './document';
import { hover } from './hover';
import { documentSymbols } from './symbols';
import { validate, type Problem, type Severity } from './validation';
import { findWorkspaceFiles, isModelFile } from './scan';
import { rangeOf, REF_TARGET, WorkspaceIndex, type FileEntry, type Location } from './workspace';
import { ModelIndex } from './models';
import { PathResolver } from './paths/resolver';
import { modelReferenceAt, pathCompletions, pathDefinitions, pathHover, pathInlayHints, siteAt, type Target } from './paths/features';
import { lineInfo } from './cursor';

interface Settings {
  validation: { enable: boolean; paths: boolean };
  inlayHints: { enable: boolean };
}

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
const parsed = new Map<string, { version: number; doc: FcDocument | undefined }>();
const index = new WorkspaceIndex();
const models = new ModelIndex();
const resolver = new PathResolver(index, models);
let settings: Settings = { validation: { enable: true, paths: true }, inlayHints: { enable: true } };
let workspaceRoots: string[] = [];
/** reference warnings wait until every file of the workspace has been indexed */
let indexReady = false;

/** The parsed mapping file, or undefined when the document is not a FHIRConnect file. */
function fcDocument(document: TextDocument): FcDocument | undefined {
  const cached = parsed.get(document.uri);
  if (cached && cached.version === document.version) return cached.doc;
  const doc = parseFcDocument(document.getText());
  parsed.set(document.uri, { version: document.version, doc });
  if (doc) index.setParsed(document.uri, doc);
  else index.delete(document.uri);
  return doc;
}

const SEVERITY: Record<Severity, DiagnosticSeverity> = {
  error: DiagnosticSeverity.Error,
  warning: DiagnosticSeverity.Warning,
  information: DiagnosticSeverity.Information,
};

function publishDiagnostics(document: TextDocument): void {
  const doc = fcDocument(document);
  const problems: Problem[] = [];
  if (doc && settings.validation.enable) {
    problems.push(...validate(doc));
    const entry = index.get(document.uri);
    if (indexReady && entry && doc.supportedGrammar) {
      problems.push(...index.unresolved(entry));
      if (settings.validation.paths) {
        const resolution = resolver.resolve(entry);
        problems.push(...resolution.notes, ...resolution.sites.flatMap((s) => (s.problem ? [s.problem] : [])));
      }
    }
  }
  const diagnostics: Diagnostic[] = problems.map((p) => ({
    range: { start: document.positionAt(p.start), end: document.positionAt(p.end) },
    message: p.message,
    severity: SEVERITY[p.severity],
    code: p.code,
    source: 'FHIRConnect',
  }));
  connection.sendDiagnostics({ uri: document.uri, diagnostics });
}

let republishTimer: NodeJS.Timeout | undefined;
/** Other open files may point at a name that just appeared or went away. */
function republishAll(): void {
  clearTimeout(republishTimer);
  republishTimer = setTimeout(() => documents.all().forEach(publishDiagnostics), 200);
}

async function loadSettings(): Promise<void> {
  try {
    const config = await connection.workspace.getConfiguration('fhirconnect');
    settings = {
      validation: { enable: config?.validation?.enable !== false, paths: config?.validation?.paths !== false },
      inlayHints: { enable: config?.inlayHints?.enable !== false },
    };
  } catch {
    // clients without workspace/configuration keep the defaults
  }
}

/** Indexes a file that is not open in the editor from disk: a mapping file, a template or a StructureDefinition. */
async function indexFromDisk(uri: string): Promise<void> {
  const path = URI.parse(uri).fsPath;
  if (isModelFile(path)) {
    try {
      models.set(uri, await readFile(path, 'utf8'));
    } catch {
      models.delete(uri);
    }
    return;
  }
  if (documents.get(uri)) return;
  try {
    index.set(uri, await readFile(path, 'utf8'));
  } catch {
    index.delete(uri);
  }
}

connection.onInitialize((params) => {
  workspaceRoots = (params.workspaceFolders ?? []).map((f) => URI.parse(f.uri).fsPath);
  if (workspaceRoots.length === 0 && params.rootUri) workspaceRoots = [URI.parse(params.rootUri).fsPath];
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: { triggerCharacters: TRIGGER_CHARACTERS },
      hoverProvider: true,
      documentSymbolProvider: true,
      definitionProvider: true,
      referencesProvider: true,
      renameProvider: { prepareProvider: true },
      inlayHintProvider: true,
    },
  };
});

connection.onInitialized(async () => {
  await loadSettings();
  for (const root of workspaceRoots) {
    const found = await findWorkspaceFiles(root);
    for (const file of found.mappings) {
      const uri = URI.file(file.path).toString();
      if (!documents.get(uri)) index.set(uri, file.text);
    }
    for (const file of found.models) models.set(URI.file(file.path).toString(), file.text);
  }
  indexReady = true;
  documents.all().forEach(publishDiagnostics);
  void connection.languages.inlayHint.refresh().catch(() => undefined);
});

connection.onDidChangeConfiguration(async () => {
  await loadSettings();
  documents.all().forEach(publishDiagnostics);
  void connection.languages.inlayHint.refresh().catch(() => undefined);
});

connection.onDidChangeWatchedFiles(async ({ changes }) => {
  for (const change of changes) {
    if (change.type === FileChangeType.Deleted) {
      if (isModelFile(URI.parse(change.uri).fsPath)) models.delete(change.uri);
      else if (!documents.get(change.uri)) index.delete(change.uri);
    } else {
      await indexFromDisk(change.uri);
    }
  }
  republishAll();
  void connection.languages.inlayHint.refresh().catch(() => undefined);
});

documents.onDidChangeContent((event) => {
  publishDiagnostics(event.document);
  republishAll();
});

documents.onDidClose(async (event) => {
  parsed.delete(event.document.uri);
  connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
  index.delete(event.document.uri);
  if (event.document.uri.startsWith('file:')) await indexFromDisk(event.document.uri);
  republishAll();
});

/** The open document and its index entry at a request's position. */
function at(params: { textDocument: { uri: string }; position: { line: number; character: number } }) {
  const document = documents.get(params.textDocument.uri);
  const doc = document && fcDocument(document);
  const entry = doc && index.get(params.textDocument.uri);
  if (!document || !doc || !entry) return undefined;
  return { document, doc, entry, offset: document.offsetAt(params.position) };
}

function toLsp(location: Location): LspLocation {
  return { uri: location.entry.uri, range: rangeOf(location.entry, location.span) };
}

/** The mapping files a request is about: the file itself when on `metadata.name`, else what the reference names. */
function declarationsAt(entry: FileEntry, offset: number): FileEntry[] {
  if (index.isOnName(entry, offset)) return [entry];
  const ref = index.referenceAt(entry, offset);
  if (!ref || ref.kind === 'appendTo') return [];
  return index.resolve(ref.value, entry, REF_TARGET[ref.kind]);
}

connection.onCompletion((params) => {
  const found = at(params);
  if (!found) return [];
  const names: NameProvider = (kind) => {
    if (kind === 'appendTo') {
      const models = found.entry.extends ? index.resolve(found.entry.extends, found.entry, 'model') : [];
      return models.flatMap((m) => m.methods.map((method) => ({ label: method.path, detail: `method of ${m.name}` })));
    }
    return index.candidates(kind, found.entry).map((e) => ({ label: e.name!, detail: relativePath(e.uri) }));
  };
  const items = complete(found.doc, params.position, params.context?.triggerCharacter, names);
  const paths = indexReady ? pathItems(found.document, found.doc, found.entry, params.position) : [];
  return [...paths, ...items];
});

/** Completion of the next step of the path typed at `position`. */
function pathItems(document: TextDocument, doc: FcDocument, entry: FileEntry, position: { line: number; character: number }) {
  const line = document.getText({ start: { line: position.line, character: 0 }, end: position });
  const info = lineInfo(line);
  if (!info?.key || info.valueCol === undefined) return [];
  const raw = line.slice(info.valueCol);
  const quote = /^["']/.test(raw) ? 1 : 0;
  const lineStart = document.offsetAt({ line: position.line, character: 0 });
  const typed = { text: raw.slice(quote), start: lineStart + info.valueCol + quote };
  const found = pathCompletions(doc, resolver.resolve(entry), document.offsetAt(position), info.key, typed);
  if (!found) return [];
  const range = { start: document.positionAt(found.start), end: position };
  return found.items.map((item) => ({ ...item, filterText: item.filterText ?? item.label, textEdit: { range, newText: item.label } }));
}

connection.onHover((params) => {
  const found = at(params);
  if (!found) return null;
  if (indexReady) {
    const site = siteAt(resolver.resolve(found.entry), found.offset);
    const pathInfo = site && pathHover(site, found.offset);
    if (pathInfo) {
      return { contents: { kind: 'markdown', value: pathInfo.markdown }, range: rangeOf(found.entry, pathInfo) };
    }
    const model = modelReferenceAt(found.doc, models, found.offset);
    if (model) {
      const links = model.targets.map((t) => `[${relativePath(t.uri)}](${t.uri}#L${models.positionAt(t.uri, t.offset).line + 1})`);
      return { contents: { kind: 'markdown', value: [model.markdown, ...links].join('\n\n') }, range: rangeOf(found.entry, model.span) };
    }
  }
  const ref = index.referenceAt(found.entry, found.offset);
  if (ref) {
    const targets = index.targets(found.entry, ref);
    if (targets.length === 0) return null;
    const lines = targets.map((t) => {
      const { line } = rangeOf(t.entry, t.span).start;
      const link = `${t.entry.uri}#L${line + 1}`;
      return ref.kind === 'appendTo' ? `method \`${ref.value}\` in [${relativePath(t.entry.uri)}](${link})` : `${t.entry.fileType ?? 'mapping'} [${relativePath(t.entry.uri)}](${link})`;
    });
    return { contents: { kind: 'markdown', value: lines.join('\n\n') }, range: rangeOf(found.entry, ref.span) };
  }
  return hover(found.doc, params.position);
});

connection.onDefinition((params) => {
  const found = at(params);
  if (!found) return [];
  const ref = index.referenceAt(found.entry, found.offset);
  if (ref) return index.targets(found.entry, ref).map(toLsp);
  const site = siteAt(resolver.resolve(found.entry), found.offset);
  const targets = site ? pathDefinitions(site, found.offset) : modelReferenceAt(found.doc, models, found.offset)?.targets ?? [];
  return targets.map(modelLocation);
});

function modelLocation(target: Target): LspLocation {
  const position = models.positionAt(target.uri, target.offset);
  return { uri: target.uri, range: { start: position, end: position } };
}

connection.languages.inlayHint.on((params) => {
  if (!settings.inlayHints.enable || !indexReady) return [];
  const document = documents.get(params.textDocument.uri);
  const doc = document && fcDocument(document);
  const entry = doc && index.get(params.textDocument.uri);
  if (!document || !doc || !entry || !doc.supportedGrammar) return [];
  const first = document.offsetAt(params.range.start);
  const last = document.offsetAt(params.range.end);
  return pathInlayHints(doc, resolver.resolve(entry))
    .filter((h) => h.offset >= first && h.offset <= last)
    .map((h) => ({ position: document.positionAt(h.offset), label: h.label, paddingLeft: true }));
});

connection.onReferences((params) => {
  const found = at(params);
  if (!found) return [];
  return declarationsAt(found.entry, found.offset).flatMap((decl) => [
    ...(params.context.includeDeclaration && decl.nameSpan ? [toLsp({ entry: decl, span: decl.nameSpan })] : []),
    ...index.usages(decl).map((u) => toLsp({ entry: u.entry, span: u.ref.span })),
  ]);
});

connection.onPrepareRename((params) => {
  const found = at(params);
  if (!found) return null;
  const decls = declarationsAt(found.entry, found.offset);
  if (decls.length !== 1 || !decls[0].nameSpan) return null;
  const span = index.isOnName(found.entry, found.offset) ? found.entry.nameSpan! : index.referenceAt(found.entry, found.offset)!.span;
  return { range: rangeOf(found.entry, span), placeholder: decls[0].name! };
});

connection.onRenameRequest((params) => {
  const found = at(params);
  if (!found) return null;
  const newName = params.newName.trim();
  if (!newName || /[\r\n]/.test(newName)) throw new ResponseError(1, 'A mapping name must be a single non-blank line.');
  const decls = declarationsAt(found.entry, found.offset);
  if (decls.length !== 1) throw new ResponseError(1, 'This name resolves to several files; rename it from the metadata.name of the file you mean.');
  const changes: Record<string, TextEdit[]> = {};
  for (const location of index.renameLocations(decls[0])) {
    (changes[location.entry.uri] ??= []).push({ range: rangeOf(location.entry, location.span), newText: newName });
  }
  return { changes };
});

connection.onDocumentSymbol((params) => {
  const document = documents.get(params.textDocument.uri);
  const doc = document && fcDocument(document);
  if (!doc) return [];
  return documentSymbols(doc, (start, end) => ({ start: document.positionAt(start), end: document.positionAt(end) }));
});

function relativePath(uri: string): string {
  const path = URI.parse(uri).fsPath;
  for (const root of workspaceRoots) {
    if (path.startsWith(root)) return path.slice(root.length).replace(/^[\\/]+/, '').replace(/\\/g, '/');
  }
  return path;
}

documents.listen(connection);
connection.listen();
