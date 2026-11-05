/*
 * ADL 1.4 archetypes (`.adl`): the archetype id, where each node of the definition section starts, and
 * the definition itself as a tree of constrained nodes, the same shape operational templates are read
 * into, with the labels and descriptions of the original language. Model mappings resolve their
 * openEHR paths against this tree.
 *
 * The cADL reader knows the constructs archetypes use for their structure: objects with a node id,
 * attributes with existence and cardinality, `allow_archetype` slots, `use_node` internal references
 * and the primitive constraints at the leaves. Leaves are kept only as far as paths need them.
 */

import { rmAttribute } from './rm';
import type { Interval, OptAttribute, OptNode, Template } from './opt';

export interface Archetype {
  id: string;
  uri: string;
  /** offset of the root node of the definition, or of the archetype id when there is none */
  rootOffset: number;
  /** offset of each node, by its code (`at0004`), at its first occurrence in the definition */
  nodes: Map<string, number>;
  /** the definition as a tree, with the archetype as its only root; undefined when it cannot be read */
  definition?: Template;
}

const NODE = /\b[A-Z][A-Z0-9_]*\[(at[0-9]+(?:\.[0-9]+)*)\]/g;

/** Reads an ADL 1.4 archetype; returns undefined for anything else. */
export function parseAdl(uri: string, text: string): Archetype | undefined {
  const header = /^﻿?\s*archetype\b[^\n]*\n\s*([A-Za-z][\w-]*-[\w-]+-[A-Za-z_]+\.[\w-]+\.v\d+[\w.-]*)/.exec(text);
  if (!header) return undefined;
  const id = header[1];
  const definition = /^definition\b/m.exec(text);
  const end = definition ? /^(invariant|ontology|terminology)\b/m.exec(text.slice(definition.index)) : null;
  const nodes = new Map<string, number>();
  let rootOffset = header.index + header[0].length - id.length;
  const archetype: Archetype = { id, uri, rootOffset, nodes };
  if (definition) {
    const bodyEnd = end ? definition.index + end.index : text.length;
    const body = text.slice(definition.index, bodyEnd);
    for (const m of body.matchAll(NODE)) {
      const offset = definition.index + m.index;
      if (nodes.size === 0) rootOffset = offset;
      if (!nodes.has(m[1])) nodes.set(m[1], offset);
    }
    archetype.rootOffset = rootOffset;
    try {
      archetype.definition = readDefinition(archetype, text, definition.index + 'definition'.length, bodyEnd);
    } catch {
      archetype.definition = undefined;
    }
  }
  return archetype;
}

// ---------------------------------------------------------------------------------------------
// cADL

class Reader {
  pos: number;
  constructor(
    readonly text: string,
    start: number,
    readonly end: number,
  ) {
    this.pos = start;
  }

  /** Skips white space and `--` comments. */
  skip(): void {
    while (this.pos < this.end) {
      const c = this.text[this.pos];
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n' || c === '\uFEFF') this.pos++;
      else if (c === '-' && this.text[this.pos + 1] === '-') {
        const eol = this.text.indexOf('\n', this.pos);
        this.pos = eol < 0 || eol > this.end ? this.end : eol;
      } else break;
    }
  }

  peek(pattern: RegExp): RegExpExecArray | null {
    this.skip();
    pattern.lastIndex = this.pos;
    const m = pattern.exec(this.text);
    return m && m.index === this.pos ? m : null;
  }

  take(pattern: RegExp): RegExpExecArray | null {
    const m = this.peek(pattern);
    if (m) this.pos += m[0].length;
    return m;
  }

  expect(literal: string): void {
    this.skip();
    if (!this.text.startsWith(literal, this.pos)) throw new Error(`expected ${literal} at ${this.pos}`);
    this.pos += literal.length;
  }

  atEnd(): boolean {
    this.skip();
    return this.pos >= this.end;
  }

  /**
   * Skips to the bracket that closes the one just opened (`{` or `<`), past strings, regular
   * expressions, intervals and comments; returns the text in between.
   */
  balanced(open: '{' | '<'): string {
    const close = open === '{' ? '}' : '>';
    const start = this.pos;
    let depth = 1;
    while (this.pos < this.end) {
      const c = this.text[this.pos];
      if (c === '"') this.pos = closing(this.text, this.pos, '"');
      else if (c === '|' && open === '<') this.pos = closing(this.text, this.pos, '|');
      else if (c === '/' && open === '{' && /[{,\s]/.test(this.text[this.pos - 1] ?? '') && this.text[this.pos + 1] !== '/') this.pos = closing(this.text, this.pos, '/');
      else if (c === '-' && this.text[this.pos + 1] === '-') {
        const eol = this.text.indexOf('\n', this.pos);
        this.pos = eol < 0 ? this.end : eol;
        continue;
      } else if (c === open) depth++;
      else if (c === close && --depth === 0) {
        this.pos++;
        return this.text.slice(start, this.pos - 1);
      }
      this.pos++;
    }
    throw new Error('unbalanced');
  }
}

/** Offset of the delimiter that closes the string, regex or interval starting at `start`. */
function closing(text: string, start: number, delimiter: string): number {
  let i = start + 1;
  while (i < text.length && text[i] !== delimiter) {
    if (text[i] === '\\') i++;
    if (text[i] === '\n' && delimiter !== '"') return start;
    i++;
  }
  return i;
}

const TYPE = /[A-Z][A-Z0-9_]*(?:<[A-Z0-9_,<> ]+>)?/y;
const CODE = /\[(at[0-9]+(?:\.[0-9]+)*)\]/y;
const IDENT = /[a-z_][A-Za-z0-9_]*/y;
const INTERVAL = /\{\s*([0-9]+|\*)(?:\s*\.\.\s*([0-9]+|\*))?\s*(;[^}]*)?\}/y;

function readDefinition(archetype: Archetype, text: string, start: number, end: number): Template | undefined {
  const reader = new Reader(text, start, end);
  const template = { id: archetype.id, uri: archetype.uri, source: 'adl', archetypes: new Map(), idOffset: archetype.rootOffset } as Template;
  const root = readObject(reader, template, undefined, undefined);
  if (!root) return undefined;
  root.kind = 'root';
  root.archetypeId = archetype.id;
  setOwner(root, root);
  template.root = root;
  template.archetypes.set(archetype.id, [root]);
  const terms = readTerms(text);
  template.language = terms.language;
  template.concept = terms.items.get('at0000')?.text;
  const visit = (node: OptNode) => {
    const term = terms.items.get(node === root ? 'at0000' : node.nodeId);
    if (term) {
      node.label = term.text;
      node.description = term.description;
    }
    node.label = nameConstraint(node) ?? node.label;
    for (const attribute of node.attributes.values()) attribute.children.forEach(visit);
  };
  visit(root);
  return template;
}

function setOwner(node: OptNode, owner: OptNode): void {
  node.owner = owner;
  for (const attribute of node.attributes.values()) attribute.children.forEach((c) => setOwner(c, owner));
}

function newNode(template: Template, rmType: string, kind: OptNode['kind'], offset: number, parent: OptAttribute | undefined): OptNode {
  return { rmType, nodeId: '', kind, occurrences: { min: 1, max: 1 }, attributes: new Map(), offset, template, parent };
}

function interval(m: RegExpExecArray | null, fallback: Interval): Interval {
  if (!m) return fallback;
  const bound = (s: string) => (s === '*' ? undefined : Number(s));
  const min = m[1] === '*' ? 0 : Number(m[1]);
  return { min, max: m[2] === undefined ? bound(m[1]) : bound(m[2]) };
}

/** `TYPE[atNNNN] occurrences matches {a..b} matches { ... }`, a slot, an internal reference or a C_DV_* block. */
function readObject(reader: Reader, template: Template, owner: OptNode | undefined, parent: OptAttribute | undefined): OptNode | undefined {
  reader.skip();
  const offset = reader.pos;
  const keyword = reader.take(/(allow_archetype|use_node|use_archetype)\b/y)?.[1];
  const type = reader.take(TYPE);
  if (!type) throw new Error(`expected a type at ${reader.pos}`);
  const rmType = type[0].replace(/^C_DV_/, 'DV_').replace(/^C_CODE_PHRASE$/, 'CODE_PHRASE');
  const code = reader.take(CODE)?.[1] ?? '';
  const node = newNode(template, rmType, keyword === 'allow_archetype' ? 'slot' : keyword === 'use_node' ? 'internal-ref' : 'object', offset, parent);
  node.nodeId = code;
  node.owner = owner;
  if (keyword === 'use_node') {
    reader.take(/occurrences\s+matches\s*/y);
    node.occurrences = interval(reader.take(INTERVAL), node.occurrences);
    node.targetPath = reader.take(/\/[^\s]*/y)?.[0];
    return node;
  }
  if (reader.take(/occurrences\s+matches\s*/y)) node.occurrences = interval(reader.take(INTERVAL), node.occurrences);
  if (reader.take(/</y)) {
    // C_DV_QUANTITY < ... > and other domain types in dADL
    reader.balanced('<');
    return node;
  }
  if (!reader.take(/matches\s*\{/y)) return node;
  if (node.kind === 'slot') {
    const body = reader.balanced('{');
    const include = body.split(/\bexclude\b/)[0];
    node.includes = [...include.matchAll(/archetype_id\/value\s+matches\s*\{\s*\/((?:[^/\\\n]|\\.)*)\/\s*\}/g)].map((m) => m[1]);
    return node;
  }
  readBody(reader, node, template);
  return node;
}

/** The inside of an object's `matches { }`: `*`, or its attributes. */
function readBody(reader: Reader, node: OptNode, template: Template): void {
  if (reader.take(/\*\s*\}/y)) return;
  while (!reader.take(/\}/y)) {
    if (reader.atEnd()) throw new Error('unterminated object');
    const name = reader.take(IDENT);
    if (!name) {
      // an object constrained by a primitive pattern only, e.g. an ordinal list: nothing to follow
      reader.balanced('{');
      return;
    }
    let existence: Interval | undefined;
    let multiple: boolean | undefined;
    if (reader.take(/existence\s+matches\s*/y)) existence = interval(reader.take(INTERVAL), { min: 1, max: 1 });
    if (reader.take(/cardinality\s+matches\s*/y)) {
      reader.take(INTERVAL);
      multiple = true;
    }
    reader.expect('matches');
    reader.expect('{');
    const attribute: OptAttribute = {
      name: name[0],
      multiple: multiple ?? !!rmAttribute(node.rmType, name[0])?.multiple,
      existence: existence ?? { min: 0, max: 1 },
      children: [],
      owner: node,
    };
    readChildren(reader, attribute, template);
    node.attributes.set(attribute.name, attribute);
  }
}

/** The inside of an attribute's `matches { }`: objects, or a primitive constraint. */
function readChildren(reader: Reader, attribute: OptAttribute, template: Template): void {
  const owner = attribute.owner.owner ?? attribute.owner;
  while (!reader.take(/\}/y)) {
    if (reader.atEnd()) throw new Error('unterminated attribute');
    if (reader.peek(/(allow_archetype|use_node|use_archetype)\b|[A-Z][A-Z0-9_]*(?:\[|\s+(?:occurrences\s+)?matches\b|\s*<)/y)) {
      const child = readObject(reader, template, owner, attribute);
      if (child) attribute.children.push(child);
      continue;
    }
    // a primitive constraint: strings, codes, intervals, patterns, ordinals
    const offset = reader.pos;
    const body = reader.balanced('{');
    attribute.children.push(primitive(body, template, owner, attribute, offset));
    return;
  }
}

function primitive(body: string, template: Template, owner: OptNode, parent: OptAttribute, offset: number): OptNode {
  const text = body.trim();
  if (/^\[[A-Za-z0-9_.-]+::/.test(text) || /^\[ac[0-9]+\]/.test(text)) return { ...newNode(template, 'CODE_PHRASE', 'object', offset, parent), owner };
  if (/^-?[0-9]+\s*\|\s*\[/.test(text)) return { ...newNode(template, 'DV_ORDINAL', 'object', offset, parent), owner };
  const node = { ...newNode(template, primitiveType(text), 'primitive', offset, parent), owner };
  const strings = [...text.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
  if (strings.length && /^"/.test(text)) node.values = strings;
  return node;
}

function primitiveType(text: string): string {
  if (/^"|^\//.test(text)) return 'STRING';
  if (/^(True|False|true|false)\b/.test(text)) return 'BOOLEAN';
  if (/^(yyyy|YYYY)-..-..[T ]/.test(text)) return 'DATE_TIME';
  if (/^(yyyy|YYYY)-/.test(text)) return 'DATE';
  if (/^(hh|HH):/.test(text)) return 'TIME';
  if (/^P/.test(text)) return 'DURATION';
  if (/\d\.\d/.test(text)) return 'REAL';
  return 'INTEGER';
}

/** The fixed name an archetype gives a node through a `name/value` constraint. */
function nameConstraint(node: OptNode): string | undefined {
  const value = node.attributes.get('name')?.children[0]?.attributes.get('value')?.children[0];
  return value?.values?.length === 1 ? value.values[0] : undefined;
}

// ---------------------------------------------------------------------------------------------
// Ontology

interface Term {
  text?: string;
  description?: string;
}

/** The term definitions of the original language. */
function readTerms(text: string): { language?: string; items: Map<string, Term> } {
  const language = /original_language\s*=\s*<\s*\[[^:\]]+::([^\]]+)\]\s*>/.exec(text)?.[1];
  const items = new Map<string, Term>();
  const ontology = /^(ontology|terminology)\b/m.exec(text);
  if (!ontology) return { language, items };
  const rest = text.slice(ontology.index);
  const start = /term_definitions\s*=\s*</.exec(rest);
  if (!start) return { language, items };
  const section = rest.slice(start.index + start[0].length);
  const blocks = [...section.matchAll(/\["([^"]+)"\]\s*=\s*<\s*items\s*=\s*</g)];
  const index = Math.max(0, blocks.findIndex((b) => b[1] === language));
  const block = blocks[index];
  if (!block) return { language, items };
  const next = blocks[index + 1]?.index ?? section.search(/\b(constraint_definitions|term_binding|term_bindings|constraint_binding|constraint_bindings)\b/);
  const body = section.slice(block.index, next > block.index ? next : undefined);
  const string = (key: string, entry: string) => {
    const m = new RegExp(`\\b${key}\\s*=\\s*<"((?:[^"\\\\]|\\\\.)*)">`).exec(entry);
    return m ? m[1].replace(/\\(["\\])/g, '$1') : undefined;
  };
  const entries = [...body.matchAll(/\["((?:at|ac)[0-9.]+)"\]\s*=\s*</g)];
  entries.forEach((entry, i) => {
    const slice = body.slice(entry.index, entries[i + 1]?.index);
    items.set(entry[1], { text: string('text', slice), description: string('description', slice) });
  });
  return { language, items };
}
