import * as path from 'node:path';
import * as vscode from 'vscode';
import type { LanguageClient } from 'vscode-languageclient/node';
import {
  compositionFormat,
  isFhirResource,
  OpenFhirClient,
  OpenFhirError,
  type BootstrapSummary,
  type CompositionFormat,
  type OutcomeIssue,
} from './client';
import { planUpload, readLocalFile, type LocalFile, type UploadPlan } from './upload';

/** A context mapping of the workspace, as the language server lists it. */
interface ContextInfo {
  name: string;
  uri: string;
  templateId?: string;
  scope: string;
}

const TOKEN_KEY = 'fhirconnect.openfhir.token';
const UPLOAD_GLOB = '**/*.{yml,yaml,opt}';
const UPLOAD_EXCLUDE = '**/{node_modules,.git}/**';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', 'host.docker.internal']);

/**
 * Runs mappings with an openFHIR engine: keeps the engine in sync with the workspace (by reloading
 * its bootstrap folder, or by uploading the files through its REST API), sends the open FHIR resource or openEHR Composition to `$toopenehr` / `$tofhir`, and
 * shows the result next to it with the engine's issues in *Problems*.
 */
export class OpenFhirFeature {
  private readonly output = vscode.window.createOutputChannel('FHIRConnect openFHIR');
  private readonly runProblems = vscode.languages.createDiagnosticCollection('openFHIR');
  private readonly bootstrapProblems = vscode.languages.createDiagnosticCollection('openFHIR bootstrap');
  private readonly uploadProblems = vscode.languages.createDiagnosticCollection('openFHIR upload');
  private readonly savedForUpload = new Map<string, vscode.Uri>();
  private readonly status = vscode.window.createStatusBarItem('fhirconnect.openfhir', vscode.StatusBarAlignment.Right, 90);
  private syncTimer: NodeJS.Timeout | undefined;
  private remoteConfirmed = new Set<string>();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly languageClient: LanguageClient,
  ) {}

  register(): void {
    const { subscriptions } = this.context;
    this.status.name = 'openFHIR';
    this.status.command = 'fhirconnect.openfhir.checkConnection';
    this.setStatus('unknown');
    subscriptions.push(
      this.output,
      this.runProblems,
      this.bootstrapProblems,
      this.uploadProblems,
      this.status,
      vscode.commands.registerCommand('fhirconnect.openfhir.checkConnection', () => this.checkConnection()),
      vscode.commands.registerCommand('fhirconnect.openfhir.sync', () => (this.config.syncMethod === 'api' ? this.upload(undefined, true) : this.sync(true))),
      vscode.commands.registerCommand('fhirconnect.openfhir.upload', (uri?: vscode.Uri, uris?: vscode.Uri[]) =>
        this.upload(uris?.length ? uris : uri ? [uri] : undefined, true),
      ),
      vscode.commands.registerCommand('fhirconnect.openfhir.runToOpenEhr', (uri?: vscode.Uri) => this.run('toOpenEhr', uri)),
      vscode.commands.registerCommand('fhirconnect.openfhir.runToFhir', (uri?: vscode.Uri) => this.run('toFhir', uri)),
      vscode.commands.registerCommand('fhirconnect.openfhir.setToken', () => this.setToken()),
      vscode.workspace.onDidSaveTextDocument((document) => {
        this.onSave(document);
        if (document === vscode.window.activeTextEditor?.document) this.updateInputContext(vscode.window.activeTextEditor);
      }),
      vscode.window.onDidChangeActiveTextEditor((editor) => this.updateInputContext(editor)),
      vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration('fhirconnect.openfhir') && this.setStatus('unknown')),
    );
    this.status.show();
    this.updateInputContext(vscode.window.activeTextEditor);
  }

  /** `fhirconnect.openfhirInput` shows the run buttons on JSON files the engine can map. */
  private updateInputContext(editor: vscode.TextEditor | undefined): void {
    let kind: 'fhir' | 'composition' | undefined;
    const document = editor?.document;
    if (document?.languageId === 'json' && document.getText().length < 20_000_000) {
      try {
        const json: unknown = JSON.parse(document.getText());
        kind = isFhirResource(json) ? 'fhir' : compositionFormat(json) ? 'composition' : undefined;
      } catch {
        kind = undefined;
      }
    }
    void vscode.commands.executeCommand('setContext', 'fhirconnect.openfhirInput', kind);
  }

  private get config() {
    const config = vscode.workspace.getConfiguration('fhirconnect.openfhir');
    return {
      url: config.get<string>('url', 'http://localhost:8080').trim() || 'http://localhost:8080',
      syncOnSave: config.get<boolean>('syncOnSave', true),
      syncMethod: config.get<'bootstrap' | 'api'>('syncMethod', 'bootstrap'),
      format: config.get<CompositionFormat>('format', 'canonical'),
      bootstrapFolder: config.get<string>('bootstrapFolder', ''),
    };
  }

  private async client(): Promise<OpenFhirClient> {
    const token = await this.context.secrets.get(TOKEN_KEY);
    return new OpenFhirClient({ baseUrl: this.config.url, token: token || undefined });
  }

  // -------------------------------------------------------------------------------------------
  // Connection and bootstrap

  private async checkConnection(): Promise<void> {
    const { url, syncMethod } = this.config;
    try {
      const client = await this.client();
      if (syncMethod === 'api') {
        const [contexts, models, templates] = await Promise.all((['context', 'model', 'template'] as const).map((kind) => client.listStored(kind)));
        this.setStatus('connected');
        void vscode.window.showInformationMessage(
          `openFHIR at ${url} answers: it stores ${contexts.length} context mappings, ${models.length} model and extension mappings and ${templates.length} templates.`,
        );
        return;
      }
      const loaded = await client.loadedFiles();
      this.setStatus('connected');
      void vscode.window.showInformationMessage(`openFHIR at ${url} answers: ${loaded} mapping and template files loaded.`);
    } catch (error) {
      this.fail(error, 'Check connection');
    }
  }

  private onSave(document: vscode.TextDocument): void {
    if (!this.config.syncOnSave || !/\.(ya?ml|opt)$/i.test(document.fileName)) return;
    if (document.fileName.match(/\.ya?ml$/i) && !/^grammar:\s*["']?FHIRConnect\//m.test(document.getText())) return;
    if (this.config.syncMethod === 'api') {
      if (!vscode.workspace.getWorkspaceFolder(document.uri)) return;
      this.savedForUpload.set(document.uri.toString(), document.uri);
    } else if (!this.insideBootstrapFolder(document.uri)) return;
    // several files saved at once (Save All) give one bootstrap or upload
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => {
      if (this.config.syncMethod !== 'api') return void this.sync(false);
      const saved = [...this.savedForUpload.values()];
      this.savedForUpload.clear();
      void this.upload(saved, false);
    }, 500);
  }

  /** Makes the engine reload its bootstrap folder. Only an explicit sync reports a failed connection. */
  private async sync(explicit: boolean): Promise<void> {
    const started = Date.now();
    try {
      const summary = await (await this.client()).bootstrap();
      this.setStatus('connected');
      this.log(`Bootstrap (${Date.now() - started} ms): ${describe(summary)}`);
      for (const file of summary.files.filter(isFailed)) this.log(`  failed: ${file.path}: ${file.message ?? 'no message'}`);
      this.showBootstrapProblems(summary);
      if (explicit) {
        const message = `openFHIR reloaded the mappings: ${describe(summary)}.`;
        void (summary.failed ? vscode.window.showWarningMessage(message, 'Show Problems') : vscode.window.showInformationMessage(message)).then(
          (choice) => choice && vscode.commands.executeCommand('workbench.actions.view.problems'),
        );
      }
    } catch (error) {
      if (explicit) this.fail(error, 'Sync');
      else {
        this.setStatus('error', error);
        this.log(`Bootstrap after save failed: ${message(error)}`);
      }
    }
  }

  // -------------------------------------------------------------------------------------------
  // Upload through the REST API

  /**
   * Uploads mapping files and operational templates to the REST API of the engine: each file
   * replaces the object stored under the same name, or creates a new one. `targets` are files or
   * folders; without them, the whole workspace. An explicit upload shows the plan and asks first;
   * an upload after save sends the saved files and only logs.
   */
  private async upload(targets: vscode.Uri[] | undefined, explicit: boolean): Promise<void> {
    const files = await this.localFiles(targets);
    if (files.length === 0) {
      if (explicit) void vscode.window.showWarningMessage('No FHIRConnect mapping files or operational templates (.opt) to upload.');
      return;
    }
    if (!(await this.confirmRemote(`${files.length === 1 ? 'The file' : `${files.length} files`} will be sent`))) return;
    const { url } = this.config;
    const started = Date.now();
    try {
      const client = await this.client();
      const kinds = [...new Set(files.map((f) => f.kind))];
      const stored = (await Promise.all(kinds.map((kind) => client.listStored(kind)))).flat();
      const plan = planUpload(files, stored);
      this.logPlan(plan);
      if (explicit && !(await this.confirmPlan(plan, url))) return;

      const results = await vscode.window.withProgress(
        { location: explicit ? vscode.ProgressLocation.Notification : vscode.ProgressLocation.Window, title: `Uploading to openFHIR`, cancellable: false },
        async (progress) => {
          const done: { file: LocalFile; action: 'create' | 'update'; error?: string }[] = [];
          for (const step of plan.steps) {
            progress.report({ message: this.relative(step.file.path), increment: 100 / plan.steps.length });
            try {
              await client.store(step.file.kind, step.file.content, step.id);
              done.push({ file: step.file, action: step.action });
            } catch (error) {
              // a lost connection fails every file the same way: stop at the first one
              if (error instanceof OpenFhirError && error.status === undefined) throw error;
              done.push({ file: step.file, action: step.action, error: message(error) });
            }
          }
          return done;
        },
      );
      this.setStatus('connected');
      const failed = results.filter((r) => r.error);
      const created = results.filter((r) => !r.error && r.action === 'create').length;
      const updated = results.filter((r) => !r.error && r.action === 'update').length;
      const summary = `${created} created, ${updated} updated, ${failed.length} failed${plan.skipped.length ? `, ${plan.skipped.length} skipped` : ''}`;
      this.log(`Upload to ${url} (${Date.now() - started} ms): ${summary}`);
      for (const r of failed) this.log(`  failed: ${this.relative(r.file.path)}: ${r.error}`);
      for (const r of results) this.uploadProblems.delete(vscode.Uri.parse(r.file.path));
      for (const s of plan.skipped) this.uploadProblems.delete(vscode.Uri.parse(s.file.path));
      for (const r of failed) this.setUploadProblem(r.file.path, `openFHIR did not store this file: ${r.error}`, vscode.DiagnosticSeverity.Error);
      for (const s of plan.skipped) this.setUploadProblem(s.file.path, `Not uploaded to openFHIR: ${s.reason}.`, vscode.DiagnosticSeverity.Warning);
      if (explicit || failed.length) {
        const text = `openFHIR at ${url} stored the files: ${summary}.`;
        void (failed.length || plan.skipped.length ? vscode.window.showWarningMessage(text, 'Show Problems', 'Show Log') : vscode.window.showInformationMessage(text, 'Show Log')).then(
          (choice) => {
            if (choice === 'Show Problems') void vscode.commands.executeCommand('workbench.actions.view.problems');
            if (choice === 'Show Log') this.output.show(true);
          },
        );
      }
    } catch (error) {
      if (explicit) this.fail(error, 'Upload');
      else {
        this.setStatus('error', error);
        this.log(`Upload after save failed: ${message(error)}`);
      }
    }
  }

  /** The uploadable files under the targets (files or folders), or of the whole workspace. */
  private async localFiles(targets: vscode.Uri[] | undefined): Promise<LocalFile[]> {
    const uris = new Map<string, vscode.Uri>();
    const add = (uri: vscode.Uri) => uris.set(uri.toString(), uri);
    if (!targets) (await vscode.workspace.findFiles(UPLOAD_GLOB, UPLOAD_EXCLUDE)).forEach(add);
    for (const target of targets ?? []) {
      const stat = await vscode.workspace.fs.stat(target).then(undefined, () => undefined);
      if (stat?.type === vscode.FileType.Directory) (await vscode.workspace.findFiles(new vscode.RelativePattern(target, UPLOAD_GLOB), UPLOAD_EXCLUDE)).forEach(add);
      else if (stat) add(target);
    }
    const decoder = new TextDecoder();
    const files = await Promise.all(
      [...uris.values()].map(async (uri) => {
        const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
        const content = open ? open.getText() : decoder.decode(await vscode.workspace.fs.readFile(uri));
        return readLocalFile(uri.toString(), content);
      }),
    );
    return files.filter((f): f is LocalFile => !!f);
  }

  /** Shows what the upload will do and asks to go on. */
  private async confirmPlan(plan: UploadPlan, url: string): Promise<boolean> {
    if (plan.steps.length === 0) {
      void vscode.window.showWarningMessage(`Nothing to upload: ${plan.skipped.length} file(s) skipped. See View → Output → FHIRConnect openFHIR.`, 'Show Log').then(
        (choice) => choice && this.output.show(true),
      );
      return false;
    }
    const created = plan.steps.filter((s) => s.action === 'create');
    const updated = plan.steps.filter((s) => s.action === 'update');
    const lines = plan.steps.map((s) => `${s.action === 'create' ? 'new' : 'replace'}: ${this.relative(s.file.path)}${s.replaces ? ` (stored as ${s.replaces})` : ''}`);
    const shown = lines.slice(0, 25);
    if (lines.length > shown.length) shown.push(`… and ${lines.length - shown.length} more (see the log)`);
    if (plan.skipped.length) shown.push('', `${plan.skipped.length} file(s) skipped, see the log.`);
    const choice = await vscode.window.showInformationMessage(
      `Upload ${plan.steps.length} file(s) to openFHIR at ${url}? ${created.length} new, ${updated.length} replace what the engine stores under the same name.`,
      { modal: true, detail: shown.join('\n') },
      'Upload',
    );
    return choice === 'Upload';
  }

  private logPlan(plan: UploadPlan): void {
    this.log(`Upload plan: ${plan.steps.length} file(s), ${plan.skipped.length} skipped`);
    for (const s of plan.steps) this.log(`  ${s.action}: ${this.relative(s.file.path)}${s.replaces ? ` (replaces ${s.replaces})` : ''}`);
    for (const s of plan.skipped) this.log(`  skipped: ${this.relative(s.file.path)}: ${s.reason}`);
  }

  private setUploadProblem(uri: string, text: string, level: vscode.DiagnosticSeverity): void {
    const diagnostic = new vscode.Diagnostic(new vscode.Range(0, 0, 0, 0), text, level);
    diagnostic.source = 'openFHIR';
    this.uploadProblems.set(vscode.Uri.parse(uri), [diagnostic]);
  }

  private relative(uri: string): string {
    return vscode.workspace.asRelativePath(vscode.Uri.parse(uri));
  }

  /** Files the engine could not load, as problems on the files of the bootstrap folder. */
  private showBootstrapProblems(summary: BootstrapSummary): void {
    this.bootstrapProblems.clear();
    const root = this.bootstrapRoot();
    if (!root) return;
    const byFile = new Map<string, vscode.Diagnostic[]>();
    for (const file of summary.files.filter(isFailed)) {
      const uri = vscode.Uri.file(path.resolve(root, file.path.replace(/^\/?app\/bootstrap\//, '')));
      const diagnostic = new vscode.Diagnostic(new vscode.Range(0, 0, 0, 0), `openFHIR could not load this file: ${file.message ?? 'no reason given'}`);
      diagnostic.source = 'openFHIR';
      byFile.set(uri.toString(), [...(byFile.get(uri.toString()) ?? []), diagnostic]);
    }
    for (const [uri, diagnostics] of byFile) this.bootstrapProblems.set(vscode.Uri.parse(uri), diagnostics);
  }

  /** The workspace folder the engine reads as its bootstrap folder. */
  private bootstrapRoot(): string | undefined {
    const first = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const setting = this.config.bootstrapFolder.trim();
    if (!setting) return first;
    return path.isAbsolute(setting) || !first ? setting : path.resolve(first, setting);
  }

  private insideBootstrapFolder(uri: vscode.Uri): boolean {
    const root = this.bootstrapRoot();
    if (!root) return false;
    const relative = path.relative(root, uri.fsPath);
    return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative);
  }

  private async setToken(): Promise<void> {
    const token = await vscode.window.showInputBox({
      title: 'openFHIR token',
      prompt: 'Bearer token sent to the openFHIR engine. Leave it empty to remove the stored token.',
      password: true,
      ignoreFocusOut: true,
    });
    if (token === undefined) return;
    if (token.trim()) await this.context.secrets.store(TOKEN_KEY, token.trim());
    else await this.context.secrets.delete(TOKEN_KEY);
    void vscode.window.showInformationMessage(token.trim() ? 'openFHIR token stored.' : 'openFHIR token removed.');
  }

  // -------------------------------------------------------------------------------------------
  // Running a mapping

  private async run(direction: 'toOpenEhr' | 'toFhir', uri?: vscode.Uri): Promise<void> {
    const document = uri ? await vscode.workspace.openTextDocument(uri) : vscode.window.activeTextEditor?.document;
    if (!document) {
      void vscode.window.showWarningMessage('Open the JSON file to map first: a FHIR resource or Bundle, or an openEHR Composition.');
      return;
    }
    const text = document.getText();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      void vscode.window.showWarningMessage(`${path.basename(document.fileName)} is not valid JSON.`);
      return;
    }
    const format = compositionFormat(json);
    if (direction === 'toOpenEhr' && !isFhirResource(json)) {
      void vscode.window.showWarningMessage('Run Mapping to openEHR needs a FHIR resource or Bundle (JSON with a resourceType).');
      return;
    }
    if (direction === 'toFhir' && !format) {
      void vscode.window.showWarningMessage('Run Mapping to FHIR needs an openEHR Composition in canonical or flat JSON.');
      return;
    }
    if (!(await this.confirmRemote('The file will be sent'))) return;

    const suggested = direction === 'toFhir' && format === 'canonical' ? canonicalTemplateId(json) : undefined;
    const templateId = await this.pickTemplate(document, direction, format, suggested);
    if (templateId === null) return;

    const client = await this.client();
    const started = Date.now();
    const label = direction === 'toOpenEhr' ? 'Mapping to openEHR' : 'Mapping to FHIR';
    try {
      const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `${label} with openFHIR…` }, async () =>
        direction === 'toOpenEhr'
          ? client.toOpenEhr(text, { templateId, format: this.config.format })
          : client.toFhir(text, { templateId }).then((r) => ({ output: JSON.stringify(r.bundle, null, 2), issues: r.issues })),
      );
      const output = 'composition' in result ? result.composition : result.output;
      this.setStatus('connected');
      this.log(`${label} of ${path.basename(document.fileName)}${templateId ? ` with template ${templateId}` : ''} (${Date.now() - started} ms): ${result.issues.length} issue(s)`);
      for (const issue of result.issues) this.log(`  ${issue.severity}: ${issue.text}${issue.expression ? ` (${issue.expression.join(', ')})` : ''}`);
      this.showRunProblems(document.uri, result.issues);
      const shown = await vscode.workspace.openTextDocument({ language: 'json', content: output });
      await vscode.window.showTextDocument(shown, { viewColumn: vscode.ViewColumn.Beside, preview: true });
      if (result.issues.length) {
        void vscode.window
          .showWarningMessage(`openFHIR reported ${result.issues.length} issue(s) for ${path.basename(document.fileName)}.`, 'Show Problems')
          .then((choice) => choice && vscode.commands.executeCommand('workbench.actions.view.problems'));
      }
    } catch (error) {
      if (error instanceof OpenFhirError) this.showRunProblems(document.uri, error.issues);
      this.fail(error, label);
    }
  }

  /**
   * The template to map with: one of the contexts of the workspace, remembered per input file.
   * `undefined` lets the engine choose; `null` means the pick was cancelled.
   */
  private async pickTemplate(
    document: vscode.TextDocument,
    direction: 'toOpenEhr' | 'toFhir',
    format: CompositionFormat | undefined,
    suggested: string | undefined,
  ): Promise<string | undefined | null> {
    const contexts = await this.languageClient.sendRequest<ContextInfo[]>('fhirconnect/contexts').catch(() => [] as ContextInfo[]);
    const templates = new Map<string, string[]>();
    for (const c of contexts) if (c.templateId && c.scope !== 'sub') templates.set(c.templateId, [...(templates.get(c.templateId) ?? []), c.name]);
    const key = `fhirconnect.openfhir.template:${document.uri.toString()}`;
    const remembered = this.context.workspaceState.get<string>(key);
    const required = direction === 'toFhir' && format === 'flat';
    type Item = vscode.QuickPickItem & { templateId?: string };
    const items: Item[] = [...templates].map(([templateId, names]) => ({
      label: templateId,
      description: names.join(', '),
      detail: templateId === suggested ? 'template of the composition' : undefined,
      templateId,
    }));
    if (suggested && !templates.has(suggested)) items.push({ label: suggested, description: 'template of the composition, no context in the workspace', templateId: suggested });
    if (!required) items.unshift({ label: 'Let openFHIR choose', description: direction === 'toOpenEhr' ? 'by the profile of the resource' : 'by the template of the composition' });
    const preferred = remembered ?? suggested;
    items.sort((a, b) => Number(b.templateId === preferred && !!preferred) - Number(a.templateId === preferred && !!preferred));
    if (items.length === 0) {
      void vscode.window.showWarningMessage('A flat composition needs its template, and no context mapping of the workspace names one.');
      return null;
    }
    const picked = await vscode.window.showQuickPick(items, {
      title: direction === 'toOpenEhr' ? 'Run Mapping to openEHR' : 'Run Mapping to FHIR',
      placeHolder: 'Template (context mapping) to map with',
      matchOnDescription: true,
    });
    if (!picked) return null;
    await this.context.workspaceState.update(key, picked.templateId);
    return picked.templateId;
  }

  private showRunProblems(uri: vscode.Uri, issues: OutcomeIssue[]): void {
    this.runProblems.set(
      uri,
      issues.map((issue) => {
        const where = issue.expression?.length ? ` (${issue.expression.join(', ')})` : '';
        const diagnostic = new vscode.Diagnostic(new vscode.Range(0, 0, 0, 0), `${issue.text}${where}`, severity(issue.severity));
        diagnostic.source = 'openFHIR';
        diagnostic.code = issue.code;
        return diagnostic;
      }),
    );
  }

  /** Files leave the computer only after the user agrees, once per engine and session. */
  private async confirmRemote(what: string): Promise<boolean> {
    const { url } = this.config;
    let host: string;
    try {
      host = new URL(url).hostname;
    } catch {
      void vscode.window.showErrorMessage(`fhirconnect.openfhir.url is not a valid URL: ${url}`);
      return false;
    }
    if (LOCAL_HOSTS.has(host) || this.remoteConfirmed.has(url)) return true;
    const choice = await vscode.window.showWarningMessage(
      `${what} to the openFHIR engine at ${url}, which is not on this computer. Do not send real patient data to a test engine.`,
      { modal: true },
      'Send',
    );
    if (choice !== 'Send') return false;
    this.remoteConfirmed.add(url);
    return true;
  }

  // -------------------------------------------------------------------------------------------

  private setStatus(state: 'unknown' | 'connected' | 'error', error?: unknown): void {
    const { url } = this.config;
    this.status.text = state === 'connected' ? '$(check) openFHIR' : state === 'error' ? '$(error) openFHIR' : '$(plug) openFHIR';
    this.status.tooltip = state === 'error' ? `openFHIR at ${url}: ${message(error)}\nClick to check again.` : `openFHIR at ${url}\nClick to check the connection.`;
    this.status.backgroundColor = state === 'error' ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
  }

  private fail(error: unknown, action: string): void {
    this.setStatus('error', error);
    this.log(`${action} failed: ${message(error)}`);
    void vscode.window.showErrorMessage(message(error), 'Open Settings', 'Show Log').then((choice) => {
      if (choice === 'Open Settings') void vscode.commands.executeCommand('workbench.action.openSettings', 'fhirconnect.openfhir');
      if (choice === 'Show Log') this.output.show(true);
    });
  }

  private log(line: string): void {
    this.output.appendLine(`[${new Date().toLocaleTimeString()}] ${line}`);
  }
}

function isFailed(file: { outcome: string }): boolean {
  return /fail/i.test(file.outcome);
}

function describe(summary: BootstrapSummary): string {
  return `${summary.created} created, ${summary.updated} updated, ${summary.unchanged} unchanged, ${summary.failed} failed`;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function severity(level: OutcomeIssue['severity']): vscode.DiagnosticSeverity {
  if (level === 'warning') return vscode.DiagnosticSeverity.Warning;
  if (level === 'information') return vscode.DiagnosticSeverity.Information;
  return vscode.DiagnosticSeverity.Error;
}

/** `archetype_details.template_id.value` of a canonical Composition. */
function canonicalTemplateId(json: unknown): string | undefined {
  const details = (json as { archetype_details?: { template_id?: { value?: unknown } } }).archetype_details;
  return typeof details?.template_id?.value === 'string' ? details.template_id.value : undefined;
}
