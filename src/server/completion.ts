import {
  CompletionItemKind,
  InsertTextFormat,
  type CompletionItem,
  type Position,
  type Range,
} from 'vscode-languageserver';
import { isRequired, keysFor, resolvePath, type KeySpec, type ScalarSpec, type ValueSpec } from './grammar';
import { cursorContext } from './cursor';
import type { FcDocument } from './document';
import { keyDocumentation, markdown, VARIABLE_DOCS } from './docs';
import type { RefKind } from './workspace';

/** A mapping (or method) name offered where a reference is typed. */
export interface NameCandidate {
  label: string;
  detail?: string;
}

/** Supplies names from the workspace index for a reference of `kind`. */
export type NameProvider = (kind: RefKind) => NameCandidate[];

/** Which keys hold references, by the block they sit in. */
const REFERENCE_KEYS: Record<string, Partial<Record<string, RefKind>>> = {
  method: { slotArchetype: 'slotArchetype', slotContext: 'slotContext', appendTo: 'appendTo' },
  spec: { extends: 'extends' },
  context: { start: 'start', archetypes: 'archetypes', extensions: 'extensions', contexts: 'contexts', operational: 'operational' },
};

/** The reference kind of `key` in the map at `path`, if it holds one. */
function referenceKind(doc: FcDocument, path: string[], key: string): RefKind | undefined {
  const container = resolvePath(doc.grammar, path);
  return container?.kind === 'map' ? REFERENCE_KEYS[container.block]?.[key] : undefined;
}

function nameItems(names: NameCandidate[], range: Range): CompletionItem[] {
  return names.map((name, i) => ({
    label: name.label,
    kind: CompletionItemKind.Reference,
    detail: name.detail,
    sortText: String(i).padStart(4, '0'),
    filterText: name.label,
    textEdit: { range, newText: name.label },
  }));
}

export const TRIGGER_CHARACTERS = [' ', '$'];

export function complete(doc: FcDocument, position: Position, triggerCharacter?: string, names?: NameProvider): CompletionItem[] {
  const lines = doc.text.split(/\r?\n/);
  const ctx = cursorContext(lines, position.line, position.character);
  if (!ctx) return [];
  const grammar = doc.grammar;

  if (ctx.kind === 'value') {
    const range = { start: { line: position.line, character: ctx.start }, end: { line: position.line, character: ctx.end } };
    const refKind = referenceKind(doc, ctx.path, ctx.key);
    if (refKind) return names ? nameItems(names(refKind), range) : [];
    const spec = resolvePath(grammar, [...ctx.path, ctx.key]);
    const scalar = scalarOf(spec);
    if (!scalar?.values) return [];
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

  // `- ` in context.archetypes / context.extensions names a mapping
  if (ctx.newItem && ctx.path.length >= 2) {
    const refKind = referenceKind(doc, ctx.path.slice(0, -2), ctx.path[ctx.path.length - 2]);
    if (refKind) return names ? nameItems(names(refKind), range) : [];
  }
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
