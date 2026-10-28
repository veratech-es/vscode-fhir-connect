import {
  createConnection,
  DiagnosticSeverity,
  ProposedFeatures,
  TextDocuments,
  TextDocumentSyncKind,
  type Diagnostic,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { complete, TRIGGER_CHARACTERS } from './completion';
import { parseFcDocument, type FcDocument } from './document';
import { hover } from './hover';
import { documentSymbols } from './symbols';
import { validate, type Severity } from './validation';

interface Settings {
  validation: { enable: boolean };
}

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
const parsed = new Map<string, { version: number; doc: FcDocument | undefined }>();
let settings: Settings = { validation: { enable: true } };

/** The parsed mapping file, or undefined when the document is not a FHIRConnect file. */
function fcDocument(document: TextDocument): FcDocument | undefined {
  const cached = parsed.get(document.uri);
  if (cached && cached.version === document.version) return cached.doc;
  const doc = parseFcDocument(document.getText());
  parsed.set(document.uri, { version: document.version, doc });
  return doc;
}

const SEVERITY: Record<Severity, DiagnosticSeverity> = {
  error: DiagnosticSeverity.Error,
  warning: DiagnosticSeverity.Warning,
  information: DiagnosticSeverity.Information,
};

function publishDiagnostics(document: TextDocument): void {
  const doc = fcDocument(document);
  const diagnostics: Diagnostic[] =
    doc && settings.validation.enable
      ? validate(doc).map((p) => ({
          range: { start: document.positionAt(p.start), end: document.positionAt(p.end) },
          message: p.message,
          severity: SEVERITY[p.severity],
          code: p.code,
          source: 'FHIRConnect',
        }))
      : [];
  connection.sendDiagnostics({ uri: document.uri, diagnostics });
}

connection.onInitialize(() => ({
  capabilities: {
    textDocumentSync: TextDocumentSyncKind.Incremental,
    completionProvider: { triggerCharacters: TRIGGER_CHARACTERS },
    hoverProvider: true,
    documentSymbolProvider: true,
  },
}));

connection.onDidChangeConfiguration(async () => {
  const config = await connection.workspace.getConfiguration('fhirconnect');
  settings = { validation: { enable: config?.validation?.enable !== false } };
  documents.all().forEach(publishDiagnostics);
});

connection.onInitialized(async () => {
  try {
    const config = await connection.workspace.getConfiguration('fhirconnect');
    settings = { validation: { enable: config?.validation?.enable !== false } };
  } catch {
    // clients without workspace/configuration keep the defaults
  }
  documents.all().forEach(publishDiagnostics);
});

documents.onDidChangeContent((event) => publishDiagnostics(event.document));
documents.onDidClose((event) => {
  parsed.delete(event.document.uri);
  connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
});

connection.onCompletion((params) => {
  const document = documents.get(params.textDocument.uri);
  const doc = document && fcDocument(document);
  return doc ? complete(doc, params.position, params.context?.triggerCharacter) : [];
});

connection.onHover((params) => {
  const document = documents.get(params.textDocument.uri);
  const doc = document && fcDocument(document);
  return doc ? hover(doc, params.position) : null;
});

connection.onDocumentSymbol((params) => {
  const document = documents.get(params.textDocument.uri);
  const doc = document && fcDocument(document);
  if (!doc) return [];
  return documentSymbols(doc, (start, end) => ({ start: document.positionAt(start), end: document.positionAt(end) }));
});

documents.listen(connection);
connection.listen();
