import { isMap, isScalar, isSeq, type Node, type Pair, type YAMLMap } from 'yaml';
import { isRequired, keysFor, SUPPORTED_VERSIONS, type Grammar, type ScalarSpec, type ValueSpec } from './grammar';
import type { FcDocument } from './document';

export type Severity = 'error' | 'warning' | 'information';

/** A problem found in a mapping file, with offsets into its text. */
export interface Problem {
  start: number;
  end: number;
  message: string;
  severity: Severity;
  code: string;
}

export function validate(doc: FcDocument): Problem[] {
  const problems: Problem[] = [];
  for (const error of doc.yaml.errors) {
    problems.push({ start: error.pos[0], end: error.pos[1], message: error.message, severity: 'error', code: 'yaml-syntax' });
  }
  if (!doc.supportedGrammar) {
    const at = /^grammar:.*$/m.exec(doc.text);
    const start = at ? at.index : 0;
    problems.push({
      start,
      end: start + (at ? at[0].length : 0),
      message: `FHIRConnect grammar v${doc.version} is not supported yet (supported: ${SUPPORTED_VERSIONS.map((v) => 'v' + v).join(', ')}). The file is not validated.`,
      severity: 'information',
      code: 'unsupported-grammar',
    });
    return problems;
  }
  const root = doc.yaml.contents;
  if (isMap(root)) {
    new Validator(doc, doc.supportedGrammar, problems).map(root, doc.supportedGrammar.root, nodeRange(root), 0);
  } else if (root) {
    problems.push(at(root, 'A FHIRConnect file must be a YAML map with grammar, type, metadata and spec.', 'error', 'not-a-map'));
  }
  return problems;
}

class Validator {
  constructor(
    private readonly doc: FcDocument,
    private readonly grammar: Grammar,
    private readonly problems: Problem[],
  ) {}

  /**
   * @param anchor where problems about the map as a whole (missing keys) are reported
   * @param depth method nesting depth, 0 for top-level methods
   */
  map(node: YAMLMap, blockName: string, anchor: [number, number], depth: number): void {
    const block = this.grammar.blocks[blockName];
    const fileType = this.doc.fileType;
    const present = new Map<string, Pair>();
    for (const pair of node.items) {
      const keyNode = pair.key as Node | null;
      if (!isScalar(keyNode)) continue;
      const key = String(keyNode.value);
      present.set(key, pair);
      const spec = block.keys[key];
      if (!spec) {
        const suggestion = closest(key, keysFor(block, fileType).map(([k]) => k));
        this.problems.push(
          at(keyNode, `Unknown key \`${key}\` in ${article(block.label)}.${suggestion ? ` Did you mean \`${suggestion}\`?` : ''}`, 'warning', 'unknown-key'),
        );
        continue;
      }
      if (fileType && spec.fileTypes && !spec.fileTypes.includes(fileType)) {
        this.problems.push(
          at(keyNode, `\`${key}\` is only used in ${spec.fileTypes.join(' and ')} files, this is a ${fileType} file.`, 'warning', 'wrong-file-type'),
        );
      }
      const childDepth = key === 'followedBy' || key === 'reference' ? depth + 1 : depth;
      this.value(pair.value as Node | null, spec.value, key, nodeRange(keyNode), childDepth);
    }
    for (const [key, spec] of Object.entries(block.keys)) {
      if (isRequired(spec, fileType) && !present.has(key)) {
        this.problems.push({ start: anchor[0], end: anchor[1], message: `Missing required key \`${key}\` in ${article(block.label)}.`, severity: 'error', code: 'missing-key' });
      }
    }
    this.blockRules(blockName, present, anchor, depth);
  }

  private value(node: Node | null, spec: ValueSpec, key: string, keyRange: [number, number], depth: number): void {
    if (node === null || (isScalar(node) && node.value === null)) return; // an empty value is left to the engine
    switch (spec.kind) {
      case 'scalar':
        if (!isScalar(node)) {
          this.problems.push(at(node, `\`${key}\` expects a single value, not a ${isSeq(node) ? 'list' : 'map'}.`, 'error', 'wrong-shape'));
        } else {
          this.scalar(node.value, node, spec, key);
        }
        return;
      case 'scalarOrList':
        if (isScalar(node)) {
          this.scalar(node.value, node, spec.scalar, key);
          return;
        }
        if (!isSeq(node)) {
          this.problems.push(at(node, `\`${key}\` expects a value or a list of values, not a map.`, 'error', 'wrong-shape'));
          return;
        }
        this.items(node.items as (Node | null)[], spec.scalar, key, depth);
        return;
      case 'map':
        if (!isMap(node)) {
          this.problems.push(at(node, `\`${key}\` expects a map of keys.`, 'error', 'wrong-shape'));
          return;
        }
        this.map(node, spec.block, keyRange, depth);
        return;
      case 'list':
        if (!isSeq(node)) {
          this.problems.push(at(node, `\`${key}\` expects a list (items starting with \`- \`).`, 'error', 'wrong-shape'));
          return;
        }
        this.items(node.items as (Node | null)[], spec.item, key, depth);
        return;
    }
  }

  private items(items: (Node | null)[], spec: ValueSpec, key: string, depth: number): void {
    for (const item of items) {
      if (item === null || (isScalar(item) && item.value === null)) {
        const range = item ? nodeRange(item) : undefined;
        if (range) this.problems.push({ start: range[0], end: range[1], message: `Empty item in \`${key}\`.`, severity: 'warning', code: 'empty-item' });
        continue;
      }
      this.value(item, spec, key, firstKeyRange(item) ?? nodeRange(item), depth);
    }
  }

  private scalar(value: unknown, node: Node, spec: ScalarSpec, key: string): void {
    if (spec.type === 'boolean') {
      if (typeof value !== 'boolean') this.problems.push(at(node, `\`${key}\` expects \`true\` or \`false\`.`, 'error', 'wrong-type'));
      return;
    }
    if (!spec.strict || !spec.values) return;
    const text = String(value);
    const matches = spec.caseInsensitive
      ? spec.values.some((v) => v.toLowerCase() === text.toLowerCase())
      : spec.values.includes(text);
    if (!matches) {
      this.problems.push(
        at(node, `\`${text}\` is not a valid value for \`${key}\`. Expected ${spec.values.map((v) => `\`${v}\``).join(', ')}.`, 'warning', 'invalid-value'),
      );
    }
  }

  /** Rules that span several keys of one block. */
  private blockRules(blockName: string, present: Map<string, Pair>, anchor: [number, number], depth: number): void {
    const warn = (message: string, code: string) =>
      this.problems.push({ start: anchor[0], end: anchor[1], message, severity: 'warning', code });
    if (blockName === 'method' && this.doc.fileType === 'extension' && depth === 0 && !present.has('extension')) {
      const engine = this.grammar.engine ? `the ${this.grammar.engine} engine fails on methods without it` : 'methods without it are not applied';
      warn(`Methods of an extension file need \`extension: add\`, \`append\` or \`overwrite\`; ${engine}.`, 'missing-extension');
    }
    if (blockName === 'method' && scalarValue(present.get('extension')) === 'append' && !present.has('appendTo')) {
      warn('`extension: append` needs `appendTo` with the name of the method to append to.', 'missing-append-to');
    }
    if (blockName === 'method' && present.has('slotArchetype') && present.has('slotContext')) {
      warn('Use either `slotArchetype` or `slotContext`, not both.', 'conflicting-keys');
    }
    if (blockName === 'method' && present.has('slotContext')) {
      const withMap = present.get('with')?.value;
      const openehr = isMap(withMap) ? withMap.get('openehr') : undefined;
      if (typeof openehr === 'string' && openehr.trim() === '$reference') {
        warn('A `slotContext` with `openehr: $reference` would create a separate composition, which sub-contexts do not support; use `link` instead.', 'slot-context-reference');
      }
    }
    if (blockName === 'condition') {
      if (present.has('targetAttribute') && present.has('targetAttributes')) {
        warn('Use either `targetAttribute` or `targetAttributes`, not both.', 'conflicting-keys');
      }
      if (present.has('criteria') && present.has('criterias')) {
        warn('Use either `criteria` or `criterias`, not both.', 'conflicting-keys');
      }
    }
  }
}

function scalarValue(pair: Pair | undefined): string | undefined {
  const value = pair?.value as Node | null | undefined;
  return isScalar(value) ? String(value.value) : undefined;
}

function nodeRange(node: Node): [number, number] {
  const range = node.range ?? [0, 0, 0];
  return [range[0], range[1]];
}

/** Range of the first key of a map item, so problems about the item point at `- name: ...`. */
function firstKeyRange(node: Node): [number, number] | undefined {
  if (!isMap(node) || node.items.length === 0) return undefined;
  const first = node.items[0];
  const value = first.value as Node | null;
  const key = first.key as Node;
  const end = value?.range ? value.range[1] : key.range?.[1] ?? 0;
  return [key.range?.[0] ?? 0, end];
}

function at(node: Node, message: string, severity: Severity, code: string): Problem {
  const [start, end] = nodeRange(node);
  return { start, end, message, severity, code };
}

function article(label: string): string {
  return /^[aeiou]/i.test(label) ? `an ${label}` : `a ${label}`;
}

/** The candidate closest to `word` when it looks like a typo (edit distance of at most 2). */
export function closest(word: string, candidates: string[]): string | undefined {
  let best: string | undefined;
  let bestDistance = 3;
  for (const candidate of candidates) {
    const d = distance(word.toLowerCase(), candidate.toLowerCase());
    if (d < bestDistance) {
      best = candidate;
      bestDistance = d;
    }
  }
  return best;
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}
