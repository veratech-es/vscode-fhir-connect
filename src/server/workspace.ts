import { isMap, isScalar, isSeq, Scalar, type Node, type Pair, type YAMLMap } from 'yaml';
import { URI } from 'vscode-uri';
import type { FileType } from './grammar';
import { parseFcDocument, type FcDocument } from './document';
import type { Problem } from './validation';

/** The places whose value names another mapping file (or, for `appendTo`, a method of the extended model). */
export type RefKind = 'slotArchetype' | 'extends' | 'archetypes' | 'extensions' | 'start' | 'appendTo';

/** File type each reference kind points at; `appendTo` points at a method instead. */
export const REF_TARGET: Record<Exclude<RefKind, 'appendTo'>, FileType> = {
  slotArchetype: 'model',
  extends: 'model',
  archetypes: 'model',
  extensions: 'extension',
  start: 'model',
};

/** Offsets of a value in the file text, without its quotes. */
export interface Span {
  start: number;
  end: number;
}

export interface Reference {
  kind: RefKind;
  value: string;
  span: Span;
}

export interface MethodDecl {
  /** `name`, or `parent.child` for a method nested in `followedBy` / `reference` */
  path: string;
  span: Span;
}

export interface FileEntry {
  uri: string;
  fileType: FileType | undefined;
  /** `metadata.name` */
  name: string | undefined;
  nameSpan: Span | undefined;
  /** `spec.openEhrConfig.archetype`, accepted as an alternative name */
  archetypeId: string | undefined;
  /** `spec.extends` */
  extends: string | undefined;
  references: Reference[];
  methods: MethodDecl[];
  lineStarts: number[];
  /** directory segments, used to prefer the nearest declaration */
  dir: string[];
}

export interface Location {
  entry: FileEntry;
  span: Span;
}

/** Collects the name, references and methods of a parsed mapping file. */
export function extractEntry(uri: string, doc: FcDocument): FileEntry {
  const entry: FileEntry = {
    uri,
    fileType: doc.fileType,
    name: undefined,
    nameSpan: undefined,
    archetypeId: undefined,
    extends: undefined,
    references: [],
    methods: [],
    lineStarts: lineStarts(doc.text),
    dir: directoryOf(uri),
  };
  const root = doc.yaml.contents;
  if (!isMap(root)) return entry;

  const name = scalarAt(mapAt(root, 'metadata'), 'name');
  if (name) {
    entry.name = name.value;
    entry.nameSpan = name.span;
  }
  const spec = mapAt(root, 'spec');
  entry.archetypeId = scalarAt(mapAt(spec, 'openEhrConfig'), 'archetype')?.value;
  const extendsRef = scalarAt(spec, 'extends');
  if (extendsRef) {
    entry.extends = extendsRef.value;
    entry.references.push({ kind: 'extends', ...extendsRef });
  }

  const context = mapAt(root, 'context');
  for (const kind of ['archetypes', 'extensions'] as const) {
    const list = valueAt(context, kind);
    if (!isSeq(list)) continue;
    for (const item of list.items as Node[]) {
      const scalar = scalarOf(item);
      if (scalar) entry.references.push({ kind, ...scalar });
    }
  }
  const start = scalarAt(context, 'start');
  if (start) entry.references.push({ kind: 'start', ...start });

  const mappings = valueAt(root, 'mappings');
  if (isSeq(mappings)) collectMethods(mappings.items as Node[], '', entry);
  return entry;
}

function collectMethods(items: Node[], prefix: string, entry: FileEntry): void {
  for (const method of items) {
    if (!isMap(method)) continue;
    const name = scalarAt(method, 'name');
    const path = name ? (prefix ? `${prefix}.${name.value}` : name.value) : prefix;
    if (name) entry.methods.push({ path, span: name.span });
    for (const kind of ['slotArchetype', 'appendTo'] as const) {
      const ref = scalarAt(method, kind);
      if (ref) entry.references.push({ kind, ...ref });
    }
    for (const holder of ['followedBy', 'reference']) {
      const children = valueAt(mapAt(method, holder), 'mappings');
      if (isSeq(children)) collectMethods(children.items as Node[], path, entry);
    }
  }
}

function valueAt(map: YAMLMap | undefined, key: string): Node | null | undefined {
  const pair = map?.items.find((p: Pair) => isScalar(p.key) && String(p.key.value) === key);
  return pair?.value as Node | null | undefined;
}

function mapAt(map: YAMLMap | undefined, key: string): YAMLMap | undefined {
  const value = valueAt(map, key);
  return isMap(value) ? value : undefined;
}

function scalarAt(map: YAMLMap | undefined, key: string): { value: string; span: Span } | undefined {
  return scalarOf(valueAt(map, key));
}

function scalarOf(node: Node | null | undefined): { value: string; span: Span } | undefined {
  if (!isScalar(node) || node.value === null || node.value === undefined || !node.range) return undefined;
  const value = String(node.value).trim();
  if (!value) return undefined;
  const quoted = node.type === Scalar.QUOTE_DOUBLE || node.type === Scalar.QUOTE_SINGLE;
  const start = node.range[0] + (quoted ? 1 : 0);
  return { value, span: { start, end: start + value.length } };
}

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}

function directoryOf(uri: string): string[] {
  const segments = URI.parse(uri).path.split('/').filter(Boolean);
  segments.pop();
  return segments;
}

/** Line and character of an offset in an indexed file. */
export function positionAt(entry: FileEntry, offset: number): { line: number; character: number } {
  let low = 0;
  let high = entry.lineStarts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (entry.lineStarts[mid] <= offset) low = mid;
    else high = mid - 1;
  }
  return { line: low, character: offset - entry.lineStarts[low] };
}

export function rangeOf(entry: FileEntry, span: Span) {
  return { start: positionAt(entry, span.start), end: positionAt(entry, span.end) };
}

function commonDepth(a: string[], b: string[]): number {
  let depth = 0;
  while (depth < a.length && depth < b.length && a[depth] === b[depth]) depth++;
  return depth;
}

/** All mapping files of the workspace, by name, with the references between them. */
export class WorkspaceIndex {
  private readonly entries = new Map<string, FileEntry>();

  /** Indexes (or re-indexes) a file; files that are not FHIRConnect files are dropped. */
  set(uri: string, text: string): FileEntry | undefined {
    const doc = parseFcDocument(text);
    if (!doc) {
      this.entries.delete(uri);
      return undefined;
    }
    const entry = extractEntry(uri, doc);
    this.entries.set(uri, entry);
    return entry;
  }

  setParsed(uri: string, doc: FcDocument): FileEntry {
    const entry = extractEntry(uri, doc);
    this.entries.set(uri, entry);
    return entry;
  }

  delete(uri: string): void {
    this.entries.delete(uri);
  }

  get(uri: string): FileEntry | undefined {
    return this.entries.get(uri);
  }

  all(): IterableIterator<FileEntry> {
    return this.entries.values();
  }

  /**
   * Files declaring `name`, as the openFHIR IntelliJ plugin resolves it: exact match on `metadata.name`
   * (or the archetype id), else ignoring case; files of the expected type win when there are any; of
   * those, the ones sharing the longest directory prefix with `from` win, and ties are all returned.
   */
  resolve(name: string, from: FileEntry | undefined, expected?: FileType): FileEntry[] {
    const all = [...this.entries.values()];
    let candidates = all.filter((e) => e.name === name || e.archetypeId === name);
    if (candidates.length === 0) {
      const lower = name.toLowerCase();
      candidates = all.filter((e) => e.name?.toLowerCase() === lower || e.archetypeId?.toLowerCase() === lower);
    }
    if (expected) {
      const typed = candidates.filter((e) => e.fileType === expected);
      if (typed.length) candidates = typed;
    }
    if (candidates.length > 1 && from) {
      const depths = candidates.map((e) => commonDepth(e.dir, from.dir));
      const best = Math.max(...depths);
      candidates = candidates.filter((_, i) => depths[i] === best);
    }
    return candidates.sort((a, b) => a.uri.localeCompare(b.uri));
  }

  /** Where a reference points: the `metadata.name` of the files it names, or the methods `appendTo` names. */
  targets(entry: FileEntry, ref: Reference): Location[] {
    if (ref.kind === 'appendTo') {
      if (!entry.extends) return [];
      return this.resolve(entry.extends, entry, 'model').flatMap((model) =>
        model.methods.filter((m) => m.path === ref.value).map((m) => ({ entry: model, span: m.span })),
      );
    }
    return this.resolve(ref.value, entry, REF_TARGET[ref.kind]).flatMap((target) =>
      target.nameSpan ? [{ entry: target, span: target.nameSpan }] : [],
    );
  }

  /** The reference whose value contains `offset`. */
  referenceAt(entry: FileEntry, offset: number): Reference | undefined {
    return entry.references.find((r) => offset >= r.span.start && offset <= r.span.end);
  }

  /** True when `offset` is on the file's own `metadata.name`. */
  isOnName(entry: FileEntry, offset: number): boolean {
    return !!entry.nameSpan && offset >= entry.nameSpan.start && offset <= entry.nameSpan.end;
  }

  /** Every reference, in any file, that resolves to `target`. */
  usages(target: FileEntry): { entry: FileEntry; ref: Reference }[] {
    const result: { entry: FileEntry; ref: Reference }[] = [];
    for (const entry of this.entries.values()) {
      for (const ref of entry.references) {
        if (ref.kind === 'appendTo') continue;
        if (this.resolve(ref.value, entry, REF_TARGET[ref.kind]).includes(target)) result.push({ entry, ref });
      }
    }
    return result;
  }

  /** Text to replace when `decl` is renamed: its `metadata.name` and the references that use that name. */
  renameLocations(decl: FileEntry): Location[] {
    const locations: Location[] = decl.nameSpan ? [{ entry: decl, span: decl.nameSpan }] : [];
    // references through the archetype id keep working and are left alone
    for (const usage of this.usages(decl)) if (usage.ref.value === decl.name) locations.push({ entry: usage.entry, span: usage.ref.span });
    return locations;
  }

  /** Mapping names that fit a reference of `kind`, nearest first. */
  candidates(kind: Exclude<RefKind, 'appendTo'>, from: FileEntry | undefined): FileEntry[] {
    const expected = REF_TARGET[kind];
    const depth = (e: FileEntry) => (from ? commonDepth(e.dir, from.dir) : 0);
    return [...this.entries.values()]
      .filter((e) => e.name && e.fileType === expected && e !== from)
      .sort((a, b) => depth(b) - depth(a) || a.name!.localeCompare(b.name!));
  }

  /** References that resolve to nothing, as warnings. */
  unresolved(entry: FileEntry): Problem[] {
    const problems: Problem[] = [];
    for (const ref of entry.references) {
      if (this.targets(entry, ref).length) continue;
      if (ref.kind === 'appendTo') {
        if (!entry.extends || this.resolve(entry.extends, entry, 'model').length === 0) continue; // reported on `extends`
        problems.push({ ...ref.span, severity: 'warning', code: 'unresolved-method', message: `No method \`${ref.value}\` in the extended model \`${entry.extends}\`.` });
        continue;
      }
      problems.push({
        ...ref.span,
        severity: 'warning',
        code: 'unresolved-reference',
        message: `No ${REF_TARGET[ref.kind]} mapping named \`${ref.value}\` in the workspace.`,
      });
    }
    return problems;
  }
}
