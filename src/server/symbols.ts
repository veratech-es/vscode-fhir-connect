import { isMap, isScalar, isSeq, type Node, type Pair, type YAMLMap } from 'yaml';
import { SymbolKind, type DocumentSymbol, type Range } from 'vscode-languageserver';
import type { FcDocument } from './document';

type ToRange = (start: number, end: number) => Range;

/** Outline of a mapping file: header sections, then the tree of mapping methods. */
export function documentSymbols(doc: FcDocument, toRange: ToRange): DocumentSymbol[] {
  const root = doc.yaml.contents;
  if (!isMap(root)) return [];
  const symbols: DocumentSymbol[] = [];
  for (const pair of root.items) {
    const key = keyOf(pair);
    if (!key) continue;
    const value = pair.value as Node | null;
    if (key === 'mappings' && isSeq(value)) {
      symbols.push(symbol('mappings', SymbolKind.Namespace, pair, toRange, methods(value.items as Node[], toRange)));
    } else if (key === 'metadata' && isMap(value)) {
      symbols.push(symbol('metadata', SymbolKind.Module, pair, toRange, [], scalarAt(value, 'name')));
    } else if (key === 'context' && isMap(value)) {
      symbols.push(symbol('context', SymbolKind.Module, pair, toRange, contextChildren(value, toRange), scalarAt(value, 'start')));
    } else {
      symbols.push(symbol(key, SymbolKind.Property, pair, toRange, [], isScalar(value) ? String(value.value ?? '') : undefined));
    }
  }
  return symbols;
}

function methods(items: Node[], toRange: ToRange): DocumentSymbol[] {
  return items.filter(isMap).map((method) => {
    const name = scalarAt(method, 'name') ?? '(unnamed)';
    const children: DocumentSymbol[] = [];
    const followedBy = mapAt(method, 'followedBy');
    const followed = followedBy && seqAt(followedBy, 'mappings');
    if (followed) children.push(...methods(followed.items as Node[], toRange));
    const reference = pairAt(method, 'reference');
    const referenceMap = reference && isMap(reference.value) ? (reference.value as YAMLMap) : undefined;
    if (reference && referenceMap) {
      const refMethods = seqAt(referenceMap, 'mappings');
      children.push(
        symbol(`reference ${scalarAt(referenceMap, 'resourceType') ?? ''}`.trim(), SymbolKind.Struct, reference, toRange, refMethods ? methods(refMethods.items as Node[], toRange) : []),
      );
    }
    const manual = pairAt(method, 'manual');
    if (manual && isSeq(manual.value)) {
      for (const entry of (manual.value.items as Node[]).filter(isMap)) {
        children.push(nodeSymbol(scalarAt(entry, 'name') ?? '(manual)', SymbolKind.Constant, entry, toRange, 'manual'));
      }
    }
    return nodeSymbol(name, SymbolKind.Method, method, toRange, methodDetail(method), children);
  });
}

function methodDetail(method: YAMLMap): string | undefined {
  const extension = scalarAt(method, 'extension');
  const slot = scalarAt(method, 'slotArchetype');
  const slotContext = scalarAt(method, 'slotContext');
  const parts = [extension && `extension: ${extension}`, slot && `slot: ${slot}`, slotContext && `context: ${slotContext}`].filter(Boolean);
  return parts.length ? parts.join(' · ') : undefined;
}

function contextChildren(context: YAMLMap, toRange: ToRange): DocumentSymbol[] {
  const children: DocumentSymbol[] = [];
  for (const key of ['archetypes', 'extensions', 'contexts', 'operational']) {
    const pair = pairAt(context, key);
    if (!pair || !isSeq(pair.value)) continue;
    const names = (pair.value.items as Node[]).filter(isScalar).map((item) => nodeSymbol(String(item.value), SymbolKind.File, item, toRange));
    children.push(symbol(key, SymbolKind.Array, pair, toRange, names));
  }
  return children;
}

function keyOf(pair: Pair): string | undefined {
  const key = pair.key as Node | null;
  return isScalar(key) ? String(key.value) : undefined;
}

function pairAt(map: YAMLMap, key: string): Pair | undefined {
  return map.items.find((pair) => keyOf(pair) === key);
}

function scalarAt(map: YAMLMap, key: string): string | undefined {
  const value = pairAt(map, key)?.value as Node | null | undefined;
  return isScalar(value) && value.value !== null ? String(value.value) : undefined;
}

function mapAt(map: YAMLMap, key: string): YAMLMap | undefined {
  const value = pairAt(map, key)?.value as Node | null | undefined;
  return isMap(value) ? value : undefined;
}

function seqAt(map: YAMLMap, key: string) {
  const value = pairAt(map, key)?.value as Node | null | undefined;
  return isSeq(value) ? value : undefined;
}

function symbol(name: string, kind: SymbolKind, pair: Pair, toRange: ToRange, children: DocumentSymbol[] = [], detail?: string): DocumentSymbol {
  const key = pair.key as Node;
  const value = pair.value as Node | null;
  const start = key.range?.[0] ?? 0;
  const keyEnd = key.range?.[1] ?? start;
  const end = value?.range?.[1] ?? keyEnd;
  return { name, kind, detail, range: toRange(start, Math.max(end, keyEnd)), selectionRange: toRange(start, keyEnd), children };
}

function nodeSymbol(name: string, kind: SymbolKind, node: Node, toRange: ToRange, detail?: string, children: DocumentSymbol[] = []): DocumentSymbol {
  const [start, end] = node.range ?? [0, 0];
  let selection = toRange(start, end);
  if (isMap(node) && node.items.length) {
    const first = node.items[0].key as Node;
    selection = toRange(first.range?.[0] ?? start, ((node.items[0].value as Node | null)?.range?.[1]) ?? first.range?.[1] ?? end);
  }
  return { name: name || ' ', kind, detail, range: toRange(start, end), selectionRange: selection, children };
}
