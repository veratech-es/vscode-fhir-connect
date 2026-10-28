import {
  CompletionItemKind,
  InsertTextFormat,
  type CompletionItem,
  type Position,
} from 'vscode-languageserver';
import { isRequired, keysFor, resolvePath, type KeySpec, type ScalarSpec, type ValueSpec } from './grammar';
import { cursorContext } from './cursor';
import type { FcDocument } from './document';
import { keyDocumentation, markdown, VARIABLE_DOCS } from './docs';

export const TRIGGER_CHARACTERS = [' ', '$'];

export function complete(doc: FcDocument, position: Position, triggerCharacter?: string): CompletionItem[] {
  const lines = doc.text.split(/\r?\n/);
  const ctx = cursorContext(lines, position.line, position.character);
  if (!ctx) return [];
  const grammar = doc.grammar;

  if (ctx.kind === 'value') {
    const spec = resolvePath(grammar, [...ctx.path, ctx.key]);
    const scalar = scalarOf(spec);
    if (!scalar?.values) return [];
    const range = { start: { line: position.line, character: ctx.start }, end: { line: position.line, character: ctx.end } };
    return scalar.values.map((value, i) => ({
      label: value,
      kind: value.startsWith('$') ? CompletionItemKind.Variable : CompletionItemKind.EnumMember,
      documentation: VARIABLE_DOCS[value] ? markdown(VARIABLE_DOCS[value]) : undefined,
      sortText: String(i).padStart(3, '0'),
      filterText: value,
      textEdit: { range, newText: value },
    }));
  }

  // a space only opens the list right after `- `; indenting a new line should stay quiet
  if (triggerCharacter === ' ' && !ctx.newItem) return [];
  if (triggerCharacter === '$') return [];

  const container = resolvePath(grammar, ctx.path);
  const range = { start: { line: position.line, character: ctx.start }, end: position };
  const pad = ' '.repeat(Math.max(0, ctx.keyCol - ctx.lineIndent));
  const indent = (text: string) => text.replace(/\n/g, '\n' + pad);
  const items: CompletionItem[] = [];

  if (container?.kind === 'map') {
    const block = grammar.blocks[container.block];
    if (ctx.newItem && ctx.siblings.size === 0 && block.itemSnippet) {
      items.push({
        label: block.itemSnippet.label,
        kind: CompletionItemKind.Snippet,
        detail: block.itemSnippet.detail,
        insertTextFormat: InsertTextFormat.Snippet,
        sortText: '0',
        filterText: ctx.prefix || block.itemSnippet.body.split(':')[0],
        textEdit: { range, newText: indent(block.itemSnippet.body) },
      });
    }
    keysFor(block, doc.fileType)
      .filter(([key]) => !ctx.siblings.has(key))
      .forEach(([key, spec], i) => {
        const required = isRequired(spec, doc.fileType);
        items.push({
          label: key,
          kind: CompletionItemKind.Property,
          detail: required ? `${block.label} · required` : block.label,
          documentation: keyDocumentation(spec),
          insertTextFormat: InsertTextFormat.Snippet,
          sortText: (required ? '1' : '2') + String(i).padStart(3, '0'),
          textEdit: { range, newText: indent(keySnippet(key, spec)) },
        });
      });
    return items.sort((a, b) => (a.sortText ?? '').localeCompare(b.sortText ?? ''));
  }

  if (container?.kind === 'list' && !ctx.newItem) {
    const item = container.item;
    const snippet = item.kind === 'map' ? grammar.blocks[item.block].itemSnippet : undefined;
    if (snippet) {
      items.push({
        label: `- ${snippet.label}`,
        kind: CompletionItemKind.Snippet,
        detail: snippet.detail,
        insertTextFormat: InsertTextFormat.Snippet,
        filterText: ctx.prefix || '-',
        textEdit: { range, newText: indent('- ' + snippet.body) },
      });
    }
  }
  return items;
}

function scalarOf(spec: ValueSpec | undefined): ScalarSpec | undefined {
  if (spec?.kind === 'scalar') return spec;
  if (spec?.kind === 'scalarOrList') return spec.scalar;
  return undefined;
}

/** The text inserted for a key, with tab stops for its value. Lines after the first are relative to the key. */
export function keySnippet(key: string, spec: KeySpec): string {
  if (spec.snippet) return spec.snippet;
  const value = spec.value;
  switch (value.kind) {
    case 'map':
      return `${key}:\n  $0`;
    case 'list':
      return `${key}:\n  - $0`;
    case 'scalarOrList':
    case 'scalar': {
      const scalar = value.kind === 'scalar' ? value : value.scalar;
      if (scalar.values && scalar.strict) return `${key}: \${1|${scalar.values.map(escapeChoice).join(',')}|}`;
      return `${key}: $0`;
    }
  }
}

function escapeChoice(value: string): string {
  return value.replace(/[$|,\\]/g, (c) => '\\' + c);
}
