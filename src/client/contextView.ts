import * as vscode from 'vscode';
import type { LanguageClient } from 'vscode-languageclient/node';

/** A node of the mapping context, as the language server sends it. */
interface ContextNode {
  label: string;
  description?: string;
  tooltip?: string;
  kind: string;
  location?: { uri: string; line: number; character: number };
  children?: ContextNode[];
}

const ICONS: Record<string, string> = {
  method: 'symbol-method',
  fhir: 'flame',
  openehr: 'symbol-structure',
  model: 'file-code',
  extension: 'extensions',
  context: 'references',
  template: 'file-binary',
  profile: 'symbol-interface',
  group: 'list-tree',
  missing: 'warning',
};

/**
 * The *Mapping Context* view: what the method and file at the cursor resolve to and how they fit in
 * the project. It follows the cursor in mapping files and keeps the last tree when another editor
 * takes the focus.
 */
export class MappingContextView implements vscode.TreeDataProvider<ContextNode> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  private nodes: ContextNode[] = [];
  private timer: NodeJS.Timeout | undefined;
  private view: vscode.TreeView<ContextNode> | undefined;

  constructor(private readonly client: LanguageClient) {}

  register(context: vscode.ExtensionContext): void {
    this.view = vscode.window.createTreeView('fhirconnect.mappingContext', { treeDataProvider: this, showCollapseAll: true });
    context.subscriptions.push(
      this.view,
      this.view.onDidChangeVisibility(() => this.schedule(0)),
      vscode.window.onDidChangeTextEditorSelection((e) => this.schedule(300, e.textEditor)),
      vscode.window.onDidChangeActiveTextEditor((editor) => editor && this.schedule(0, editor)),
      vscode.commands.registerCommand('fhirconnect.showMappingContext', async () => {
        await vscode.commands.executeCommand('fhirconnect.mappingContext.focus');
        this.schedule(0);
      }),
      vscode.commands.registerCommand('fhirconnect.refreshMappingContext', () => this.schedule(0)),
      vscode.commands.registerCommand('fhirconnect.openContextNode', (node: ContextNode) => this.open(node)),
    );
    this.schedule(0);
  }

  getTreeItem(node: ContextNode): vscode.TreeItem {
    const collapsible = node.children?.length
      ? node.kind === 'method' || (node.kind !== 'group' && this.nodes.includes(node))
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None;
    const item = new vscode.TreeItem(node.label, collapsible);
    item.description = node.description;
    item.tooltip = node.tooltip ?? [node.label, node.description].filter(Boolean).join('\n');
    item.iconPath = new vscode.ThemeIcon(ICONS[node.kind] ?? 'circle-outline');
    if (node.location) item.command = { command: 'fhirconnect.openContextNode', title: 'Open', arguments: [node] };
    return item;
  }

  getChildren(node?: ContextNode): ContextNode[] {
    return node ? (node.children ?? []) : this.nodes;
  }

  /** Refreshes the tree from the cursor of `editor` (the active editor by default), after `delay` ms. */
  private schedule(delay: number, editor = vscode.window.activeTextEditor): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.update(editor), delay);
  }

  private async update(editor: vscode.TextEditor | undefined): Promise<void> {
    if (!this.view?.visible || !editor || editor.document.languageId !== 'yaml') return;
    if (!/^grammar:\s*["']?FHIRConnect\//m.test(editor.document.getText())) return;
    const position = editor.selection.active;
    try {
      this.nodes = await this.client.sendRequest<ContextNode[]>('fhirconnect/mappingContext', {
        textDocument: { uri: editor.document.uri.toString() },
        position: { line: position.line, character: position.character },
      });
    } catch {
      this.nodes = [];
    }
    this.view.message = this.nodes.length ? undefined : 'Nothing to show yet: the workspace is still being indexed, or the grammar version is not supported.';
    this.changed.fire();
  }

  private async open(node: ContextNode): Promise<void> {
    if (!node.location) return;
    const position = new vscode.Position(node.location.line, node.location.character);
    await vscode.window.showTextDocument(vscode.Uri.parse(node.location.uri), {
      selection: new vscode.Range(position, position),
      preserveFocus: false,
    });
  }
}
