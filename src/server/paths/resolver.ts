/*
 * Resolves the FHIR and openEHR paths of mapping files against the FHIR R4 definitions and the
 * operational templates of the workspace, following the rules of the openFHIR engine (grammar v0.9.0):
 *
 * - `$resource` is the root resource and `$fhirRoot` the FHIR path of the parent method; other FHIR
 *   paths continue the parent's path (`parent.child`).
 * - `$archetype` is the root of the mapped archetype, `$composition` the root of the composition and
 *   `$openehrRoot` the openEHR path of the parent method; other openEHR paths continue the parent's
 *   path (`parent/child`). `$reference` has no openEHR path: children continue the parent's.
 * - Methods in `reference.mappings` continue in the referenced resource (`parent.resolve().child`).
 * - In a model used as a `slotArchetype`, `$resource` and `$fhirRoot` stand for the FHIR path of the
 *   slot method and `$archetype` for its openEHR path.
 * - Extension methods resolve inside the extended model: `add` at its top level, `overwrite` where
 *   the overwritten method is, `append` below the method named by `appendTo`.
 *
 * Paths are only reported when the resolver is sure they are wrong; whatever it cannot follow (an
 * unfilled slot, a function it does not know, a template that is not in the workspace) is left alone.
 */

import { isMap, isSeq, type Node, type YAMLMap } from 'yaml';
import type { FcDocument } from '../document';
import type { Problem } from '../validation';
import { mapAt, scalarAt, valueAt, type FileEntry, type Span, type WorkspaceIndex } from '../workspace';
import { castType, choiceSuffix, coreType, fhirConforms, fhirElement, isResourceType, type FhirElement } from '../models/fhir';
import type { ModelIndex } from '../models';
import type { OptNode } from '../models/opt';
import { isRmClass, rmAttribute, type RmAttribute } from '../models/rm';
import { fhirSteps, openEhrSteps, type FhirStep, type OpenEhrStep } from './syntax';

export interface FhirState {
  known: boolean;
  types: string[];
  /** resource types a Reference at this point may point at */
  targets?: string[];
  /** the element the path ends on */
  element?: FhirElement;
  /** `Type.element` of that element */
  elementPath?: string;
  path: string;
}

export interface OpenEhrState {
  known: boolean;
  /** template nodes the path ends on; empty past the constrained part, where only `rmTypes` are known */
  nodes: OptNode[];
  rmTypes: string[];
  /** the RM attribute the path ends on, past the constrained part */
  rmAttribute?: RmAttribute;
  path: string;
}

export interface Step<S> {
  text: string;
  span: Span;
  before: S;
  after: S;
  /** step that also went through `value` or `defining_code`, as the engine does */
  implicit?: string;
}

export type PathSide = 'fhir' | 'openehr';

export interface PathSite {
  side: PathSide;
  /** where the path is, e.g. `with.fhir`, `fhirCondition.targetAttribute`, `manual.openehr.path` */
  key: string;
  value: string;
  span: Span;
  /** state the path starts from when it has no variable */
  base: FhirState | OpenEhrState;
  steps: Step<FhirState | OpenEhrState>[];
  result: FhirState | OpenEhrState;
  problem?: Problem;
}

export interface Context {
  fhir: FhirState;
  openehr: OpenEhrState;
  /** contexts of the enclosing methods, nearest first */
  ancestors?: Context[];
}

interface Roots {
  resource: FhirState;
  root: Context;
  archetype: OpenEhrState;
  composition: OpenEhrState;
}

export interface FileResolution {
  sites: PathSite[];
  /** context of each method, and the one its paths start from */
  methods: Map<YAMLMap, { self: Context; parent: Context }>;
  /** problems about the file as a whole */
  notes: Problem[];
  roots?: Roots;
}

const UNKNOWN_FHIR: FhirState = { known: false, types: [], path: '' };
const UNKNOWN_OPENEHR: OpenEhrState = { known: false, nodes: [], rmTypes: [], path: '' };

/** Steps the engine takes on its own when an attribute is not on the type itself. */
const IMPLICIT: Record<string, string> = { ELEMENT: 'value', DV_CODED_TEXT: 'defining_code' };

export class PathResolver {
  private cache = new Map<string, FileResolution>();
  private inProgress = new Set<string>();
  private generation = '';

  constructor(
    private readonly index: WorkspaceIndex,
    private readonly models: ModelIndex,
  ) {}

  /** Drops resolutions when the mapping files or the models changed since they were made. */
  private freshen(): void {
    const generation = `${this.index.generation}:${this.models.generation}`;
    if (generation !== this.generation) {
      this.cache.clear();
      this.generation = generation;
    }
  }

  resolve(entry: FileEntry): FileResolution {
    this.freshen();
    const cached = this.cache.get(entry.uri);
    if (cached) return cached;
    if (this.inProgress.has(entry.uri)) return { sites: [], methods: new Map(), notes: [] };
    this.inProgress.add(entry.uri);
    try {
      const resolution = this.resolveFile(entry);
      this.cache.set(entry.uri, resolution);
      return resolution;
    } finally {
      this.inProgress.delete(entry.uri);
    }
  }

  private resolveFile(entry: FileEntry): FileResolution {
    const resolution: FileResolution = { sites: [], methods: new Map(), notes: [] };
    const doc = entry.doc;
    const root = doc.yaml.contents;
    if (!isMap(root) || !doc.supportedGrammar) return resolution;
    const mappings = valueAt(root, 'mappings');
    const methods = isSeq(mappings) ? (mappings.items as Node[]).filter(isMap) : [];

    if (entry.fileType === 'model') {
      const roots = this.modelRoots(entry);
      resolution.roots = roots;
      this.noteMissingArchetype(entry, roots, resolution);
      for (const method of methods) this.method(method, roots.root, roots, resolution);
    } else if (entry.fileType === 'extension' && entry.extends) {
      const [model] = this.index.resolve(entry.extends, entry, 'model');
      if (!model || model.fileType !== 'model') return resolution;
      const base = this.resolve(model);
      if (!base.roots) return resolution;
      resolution.roots = base.roots;
      for (const method of methods) {
        const mode = scalarAt(method, 'extension')?.value;
        if (mode === 'append') {
          // the engine adds the method's conditions and followedBy methods to the target method
          const target = findMethod(model.doc, scalarAt(method, 'appendTo')?.value ?? '', true);
          const found = target && base.methods.get(target);
          const self = found?.self ?? base.roots.root;
          const parent = found?.parent ?? base.roots.root;
          resolution.methods.set(method, { self, parent });
          this.conditions(method, parent, parent.openehr, base.roots, resolution);
          this.children(method, self, base.roots, resolution);
        } else if (mode === 'overwrite') {
          const name = scalarAt(method, 'name');
          const target = findMethod(model.doc, name?.value ?? '', false);
          if (!target && name) {
            resolution.notes.push({
              ...name.span,
              severity: 'warning',
              code: 'unresolved-overwrite',
              message: `No method named \`${name.value}\` in \`${model.name}\` to overwrite; the engine looks the name up in every level, without dots, and skips the method.`,
            });
          }
          const fallback = target ?? findMethod(model.doc, name?.value ?? '', true);
          const parent = (fallback && base.methods.get(fallback)?.parent) ?? base.roots.root;
          this.method(method, parent, base.roots, resolution);
        } else {
          this.method(method, base.roots.root, base.roots, resolution);
        }
      }
    }
    return resolution;
  }

  /** Where the paths of a model start: from its own configuration, or from the slots that use it. */
  private modelRoots(entry: FileEntry): Roots {
    const doc = entry.doc;
    const root = doc.yaml.contents as YAMLMap;
    const spec = mapAt(root, 'spec');
    const url = scalarAt(mapAt(spec, 'fhirConfig'), 'structureDefinition')?.value;
    const typed = url ? this.models.typeForUrl(url) : undefined;
    const own: FhirState =
      typed && !coreType(typed.type)?.abstract ? { known: true, types: [typed.type], path: typed.type } : UNKNOWN_FHIR;

    const callers = this.index
      .usages(entry)
      .filter((u) => u.ref.kind === 'slotArchetype' && u.entry !== entry)
      .map((u) => {
        const method = findMethodWithSlot(u.entry.doc, u.ref.span.start);
        const resolution = method ? this.resolve(u.entry) : undefined;
        const context = method && resolution?.methods.get(method)?.self;
        return context && resolution?.roots ? { context, roots: resolution.roots } : undefined;
      })
      .filter((c): c is { context: Context; roots: Roots } => !!c);

    const archetypeId = entry.archetypeId;
    const occurrences = archetypeId ? this.models.archetypeRoots(archetypeId) : [];
    const archetypeState: OpenEhrState =
      occurrences.length > 0 ? { known: true, nodes: occurrences, rmTypes: rmTypesOf(occurrences), path: archetypeId! } : UNKNOWN_OPENEHR;
    const compositions = [...new Set(occurrences.map((n) => n.template.root))];
    const compositionState: OpenEhrState =
      compositions.length > 0
        ? { known: true, nodes: compositions, rmTypes: rmTypesOf(compositions), path: compositions[0].archetypeId ?? '$composition' }
        : UNKNOWN_OPENEHR;

    // a model can be used on its own and as a slot: its paths must fit every use
    const fhir = unionFhir([...(own.known || callers.length === 0 ? [own] : []), ...callers.map((c) => c.context.fhir)]);
    const slotNodes = unionOpenEhr(callers.map((c) => c.context.openehr));
    const archetype: OpenEhrState =
      archetypeState.known || !slotNodes.known || slotNodes.nodes.length === 0
        ? archetypeState
        : slotNodes;
    const callerCompositions = unionOpenEhr(callers.map((c) => c.roots.composition));
    const composition = compositionState.known || !callerCompositions.known ? compositionState : callerCompositions;
    return { resource: fhir, root: { fhir, openehr: archetype }, archetype, composition };
  }

  private noteMissingArchetype(entry: FileEntry, roots: Roots, resolution: FileResolution): void {
    if (!this.models.hasTemplates || !entry.archetypeId || roots.archetype.known) return;
    const archetype = scalarAt(mapAt(mapAt(entry.doc.yaml.contents as YAMLMap, 'spec'), 'openEhrConfig'), 'archetype');
    if (!archetype) return;
    resolution.notes.push({
      ...archetype.span,
      severity: 'information',
      code: 'archetype-not-in-templates',
      message: `No template in the workspace contains \`${entry.archetypeId}\`; its openEHR paths are not checked.`,
    });
  }

  /** Resolves a method's paths from its parent's context, then its children. */
  private method(method: YAMLMap, parent: Context, roots: Roots, resolution: FileResolution): Context {
    const withMap = mapAt(method, 'with');
    let self: Context = { ...parent, ancestors: [parent, ...(parent.ancestors ?? [])] };
    if (withMap) {
      const fhir = this.fhirSite(withMap, 'fhir', 'with.fhir', parent, roots, resolution);
      const openehr = this.openEhrSite(withMap, 'openehr', 'with.openehr', parent, roots, resolution, true);
      self = { fhir: fhir ?? parent.fhir, openehr: openehr ?? parent.openehr, ancestors: self.ancestors };
    }
    resolution.methods.set(method, { self, parent });
    this.conditions(method, parent, parent.openehr, roots, resolution);
    this.manual(method, parent, self, roots, resolution);
    this.children(method, self, roots, resolution);
    return self;
  }

  private children(method: YAMLMap, self: Context, roots: Roots, resolution: FileResolution): void {
    const followed = valueAt(mapAt(method, 'followedBy'), 'mappings');
    if (isSeq(followed)) for (const child of (followed.items as Node[]).filter(isMap)) this.method(child, self, roots, resolution);
    const reference = mapAt(method, 'reference');
    const referenced = valueAt(reference, 'mappings');
    if (isSeq(referenced)) {
      const resourceType = scalarAt(reference, 'resourceType')?.value;
      const fhir: FhirState =
        resourceType && isResourceType(resourceType)
          ? { known: true, types: [resourceType], path: `${self.fhir.path}.resolve()` }
          : self.fhir.known && self.fhir.targets
            ? { known: true, types: self.fhir.targets, path: `${self.fhir.path}.resolve()` }
            : UNKNOWN_FHIR;
      const context: Context = { fhir, openehr: self.openehr, ancestors: [] };
      for (const child of (referenced.items as Node[]).filter(isMap)) this.method(child, context, roots, resolution);
    }
  }

  /**
   * Conditions start from the parent method, as the engine places them; `$openehrRoot` in a manual
   * entry's condition is the method's own openEHR path (`openehrRoot`).
   */
  private conditions(method: YAMLMap, parent: Context, openehrRoot: OpenEhrState, roots: Roots, resolution: FileResolution): void {
    const fhirCondition = mapAt(method, 'fhirCondition');
    if (fhirCondition) {
      const root = this.fhirSite(fhirCondition, 'targetRoot', 'fhirCondition.targetRoot', parent, roots, resolution);
      if (root) this.attributeSites(fhirCondition, 'fhir', root, roots, resolution);
    }
    const openehrCondition = mapAt(method, 'openehrCondition');
    if (openehrCondition) {
      const root = this.openEhrSite(openehrCondition, 'targetRoot', 'openehrCondition.targetRoot', parent, roots, resolution, false, openehrRoot);
      if (root) this.attributeSites(openehrCondition, 'openehr', root, roots, resolution);
    }
  }

  /** `targetAttribute` / `targetAttributes`, relative to the condition's `targetRoot`. */
  private attributeSites(condition: YAMLMap, side: PathSide, root: FhirState | OpenEhrState, roots: Roots, resolution: FileResolution): void {
    const prefix = side === 'fhir' ? 'fhirCondition' : 'openehrCondition';
    const single = scalarAt(condition, 'targetAttribute');
    const list = valueAt(condition, 'targetAttributes');
    const values = [...(single ? [single] : []), ...(isSeq(list) ? (list.items as Node[]).map(scalarFrom).filter(isDefined) : [])];
    for (const value of values) {
      const key = `${prefix}.targetAttribute`;
      if (side === 'fhir') this.recordFhir(value, key, { fhir: root as FhirState, openehr: UNKNOWN_OPENEHR }, roots, resolution, false);
      else this.recordOpenEhr(value, key, { fhir: UNKNOWN_FHIR, openehr: root as OpenEhrState }, roots, resolution, false, false);
    }
  }

  /** Paths of `manual` entries, relative to the method's own paths. */
  private manual(method: YAMLMap, parent: Context, self: Context, roots: Roots, resolution: FileResolution): void {
    const manual = valueAt(method, 'manual');
    if (!isSeq(manual)) return;
    for (const entry of (manual.items as Node[]).filter(isMap)) {
      for (const side of ['fhir', 'openehr'] as const) {
        const list = valueAt(entry, side);
        if (!isSeq(list)) continue;
        for (const item of (list.items as Node[]).filter(isMap)) {
          const path = scalarAt(item, 'path');
          if (!path) continue;
          if (side === 'fhir') this.recordFhir(path, 'manual.fhir.path', { ...self, ancestors: [] }, roots, resolution, false);
          else this.recordOpenEhr(path, 'manual.openehr.path', { ...self, ancestors: [] }, roots, resolution, false, false);
        }
      }
      this.conditions(entry, parent, self.openehr, roots, resolution);
    }
  }

  private fhirSite(map: YAMLMap, key: string, label: string, parent: Context, roots: Roots, resolution: FileResolution): FhirState | undefined {
    const value = scalarAt(map, key);
    return value ? this.recordFhir(value, label, parent, roots, resolution, true) : undefined;
  }

  private openEhrSite(
    map: YAMLMap,
    key: string,
    label: string,
    parent: Context,
    roots: Roots,
    resolution: FileResolution,
    isWith: boolean,
    openehrRoot = parent.openehr,
  ): OpenEhrState | undefined {
    const value = scalarAt(map, key);
    return value ? this.recordOpenEhr(value, label, parent, roots, resolution, true, isWith, openehrRoot) : undefined;
  }

  /**
   * Resolves a path from the parent method. A relative path the parent cannot follow is tried from the
   * enclosing methods too: mappings often repeat the start of the parent's path, which the engine
   * accepts.
   */
  private recordFhir(
    value: { value: string; span: Span },
    key: string,
    parent: Context,
    roots: Roots,
    resolution: FileResolution,
    variables: boolean,
  ): FhirState {
    let site = resolveFhirPath(value.value, value.span.start, parent.fhir, roots.resource, variables);
    if (site.problem && !/^\s*\$resource/.test(value.value)) {
      for (const ancestor of parent.ancestors ?? []) {
        const retry = resolveFhirPath(value.value, value.span.start, ancestor.fhir, roots.resource, variables);
        if (!retry.problem) {
          site = retry;
          break;
        }
      }
    }
    resolution.sites.push({ side: 'fhir', key, value: value.value, span: value.span, ...site });
    return site.result;
  }

  private recordOpenEhr(
    value: { value: string; span: Span },
    key: string,
    parent: Context,
    roots: Roots,
    resolution: FileResolution,
    variables: boolean,
    isWith: boolean,
    openehrRoot = parent.openehr,
  ): OpenEhrState {
    let site = resolveOpenEhrPath(value.value, value.span.start, parent.openehr, roots, variables, openehrRoot);
    if (site.problem && !/^\s*\$(archetype|composition)/.test(value.value)) {
      for (const ancestor of [...(parent.ancestors ?? []).map((a) => a.openehr), roots.archetype]) {
        const retry = resolveOpenEhrPath(value.value, value.span.start, ancestor, roots, variables, ancestor);
        if (!retry.problem) {
          site = retry;
          break;
        }
      }
    }
    resolution.sites.push({ side: 'openehr', key, value: value.value, span: value.span, ...site });
    // `$reference` has no openEHR path of its own; children keep the parent's
    return isWith && value.value.trim() === '$reference' ? parent.openehr : site.result;
  }
}

function scalarFrom(node: Node): { value: string; span: Span } | undefined {
  const holder = { items: [{ key: { value: 'x' }, value: node }] } as unknown as YAMLMap;
  return scalarAt(holder, 'x');
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function rmTypesOf(nodes: OptNode[]): string[] {
  return [...new Set(nodes.map((n) => n.rmType).filter(Boolean))];
}

function unionFhir(states: FhirState[]): FhirState {
  if (states.length === 0 || states.some((s) => !s.known)) return UNKNOWN_FHIR;
  const targets = states.flatMap((s) => s.targets ?? []);
  return {
    known: true,
    types: [...new Set(states.flatMap((s) => s.types))],
    targets: targets.length ? [...new Set(targets)] : undefined,
    element: states[0].element,
    elementPath: states[0].elementPath,
    path: states[0].path,
  };
}

function unionOpenEhr(states: OpenEhrState[]): OpenEhrState {
  if (states.length === 0 || states.some((s) => !s.known)) return UNKNOWN_OPENEHR;
  const nodes = [...new Set(states.flatMap((s) => s.nodes))];
  return { known: true, nodes, rmTypes: [...new Set(states.flatMap((s) => s.rmTypes))], path: states[0].path };
}

/** A method by name: `appendTo` names it through `followedBy` levels (`a.b`), `overwrite` anywhere. */
function findMethod(doc: FcDocument, name: string, dotted: boolean): YAMLMap | undefined {
  const root = doc.yaml.contents;
  if (!isMap(root) || !name) return undefined;
  const top = valueAt(root, 'mappings');
  const methodsOf = (list: Node | null | undefined) => (isSeq(list) ? (list.items as Node[]).filter(isMap) : []);
  const nameOf = (m: YAMLMap) => scalarAt(m, 'name')?.value;
  if (dotted) {
    let level = methodsOf(top);
    let found: YAMLMap | undefined;
    for (const part of name.split('.')) {
      found = level.find((m) => nameOf(m) === part);
      if (!found) return undefined;
      level = methodsOf(valueAt(mapAt(found, 'followedBy'), 'mappings'));
    }
    return found;
  }
  const search = (level: YAMLMap[]): YAMLMap | undefined =>
    level.find((m) => nameOf(m) === name) ?? level.map((m) => search(methodsOf(valueAt(mapAt(m, 'followedBy'), 'mappings')))).find(Boolean);
  return search(methodsOf(top));
}

/** The method whose `slotArchetype` value starts at `offset`. */
function findMethodWithSlot(doc: FcDocument, offset: number): YAMLMap | undefined {
  let found: YAMLMap | undefined;
  const visit = (node: Node | null | undefined) => {
    if (found || !node) return;
    if (isSeq(node)) (node.items as Node[]).forEach(visit);
    else if (isMap(node)) {
      if (scalarAt(node, 'slotArchetype')?.span.start === offset) found = node;
      else for (const pair of node.items) visit(pair.value as Node);
    }
  };
  visit(doc.yaml.contents as Node);
  return found;
}

// ---------------------------------------------------------------------------------------------
// FHIR paths

interface Resolved<S> {
  base: S;
  steps: Step<S>[];
  result: S;
  problem?: Problem;
}

export function resolveFhirPath(value: string, offset: number, parent: FhirState, resource: FhirState, variables: boolean): Resolved<FhirState> {
  const parts = fhirSteps(value, offset);
  let state = parent;
  let first = 0;
  if (variables && parts[0]) {
    if (parts[0].name === '$resource') {
      state = resource;
      first = 1;
    } else if (parts[0].name === '$fhirRoot') {
      first = 1;
    }
  }
  if (parts[0]?.name === '$reference' || parts[0]?.name === '$this') return { base: parent, steps: [], result: UNKNOWN_FHIR };
  const base = state;
  const steps: Step<FhirState>[] = [];
  let problem: Problem | undefined;
  for (const part of parts.slice(first)) {
    if (part.text.trim() === '' && part === parts[parts.length - 1] && parts.length > 1) {
      steps.push({ text: '', span: { start: part.start, end: part.start }, before: state, after: state });
      break;
    }
    const outcome = fhirStep(state, part);
    steps.push({ text: part.text, span: { start: part.start, end: part.start + part.text.length }, before: state, after: outcome.state });
    if (outcome.problem) {
      problem = { start: part.start, end: part.start + part.text.length, severity: 'warning', code: outcome.code!, message: outcome.problem };
      state = UNKNOWN_FHIR;
      break;
    }
    state = outcome.state;
  }
  return { base, steps, result: state, problem };
}

function typeList(types: string[]): string {
  return types.map((t) => `\`${t}\``).join(' | ');
}

function fhirStep(state: FhirState, part: FhirStep): { state: FhirState; problem?: string; code?: string } {
  const path = `${state.path}.${part.text}`;
  if (!state.known) return { state: { ...UNKNOWN_FHIR, path } };
  if (part.args !== undefined) return fhirFunction(state, part, path);
  const name = part.name;
  const found: { owner: string; element: FhirElement; types: string[] }[] = [];
  for (const type of state.types) {
    const element = fhirElement(type, name);
    if (element) {
      found.push({ owner: type, element, types: element.types });
      continue;
    }
    // `valueQuantity` for the `Quantity` choice of `value[x]`
    for (const [choiceName, choice] of Object.entries(coreType(type)?.elements ?? {})) {
      if (!choice.choice || !name.startsWith(choiceName)) continue;
      const picked = choice.types.find((t) => choiceName + choiceSuffix(t) === name);
      if (picked) found.push({ owner: type, element: choice, types: [picked] });
    }
  }
  if (found.length === 0) {
    if (state.types.some((t) => !coreType(t) || coreType(t)?.abstract)) return { state: { ...UNKNOWN_FHIR, path } };
    const primitive = state.types.every((t) => coreType(t)?.kind === 'primitive');
    const what = primitive ? `${typeList(state.types)}, a primitive type` : typeList(state.types);
    return { state: UNKNOWN_FHIR, problem: `\`${name}\` is not an element of ${what}.`, code: 'unknown-fhir-element' };
  }
  const types = [...new Set(found.flatMap((f) => f.types))];
  const targets = found.flatMap((f) => f.element.targets ?? []);
  return {
    state: {
      known: types.every((t) => !!coreType(t)),
      types,
      targets: targets.length ? [...new Set(targets)] : undefined,
      element: found[0].element,
      elementPath: `${found[0].owner}.${name}`,
      path,
    },
  };
}

function fhirFunction(state: FhirState, part: FhirStep, path: string): { state: FhirState; problem?: string; code?: string } {
  const args = part.args!.trim();
  switch (part.name) {
    case 'as':
    case 'ofType': {
      if (args === '') return { state: { ...UNKNOWN_FHIR, path }, problem: `\`${part.name}()\` needs a type, e.g. \`${part.name}(${state.types[0] ?? 'string'})\`.`, code: 'unknown-fhir-type' };
      const type = castType(args);
      if (!type) return { state: UNKNOWN_FHIR, problem: `\`${args}\` is not a FHIR R4 type.`, code: 'unknown-fhir-type' };
      const fits = state.types.some((t) => t === type || fhirConforms(type, t) || fhirConforms(t, type));
      const resolves = isResourceType(type) && (state.types.includes('Reference') || state.types.some((t) => isResourceType(t)));
      if (!fits && !resolves) {
        return { state: UNKNOWN_FHIR, problem: `\`${state.path}\` is ${typeList(state.types)}, never \`${args}\`.`, code: 'impossible-fhir-type' };
      }
      return { state: { ...state, known: true, types: [type], path } };
    }
    case 'resolve':
      return { state: state.targets ? { known: true, types: state.targets, path } : { ...UNKNOWN_FHIR, path } };
    case 'where':
    case 'first':
    case 'last':
    case 'single':
    case 'distinct':
    case 'tail':
      return { state: { ...state, path } };
    case 'extension':
      return { state: { known: true, types: ['Extension'], path } };
    default:
      return { state: { ...UNKNOWN_FHIR, path } };
  }
}

// ---------------------------------------------------------------------------------------------
// openEHR paths

export function resolveOpenEhrPath(
  value: string,
  offset: number,
  parent: OpenEhrState,
  roots: Roots,
  variables: boolean,
  openehrRoot = parent,
): Resolved<OpenEhrState> {
  const trimmed = value.trim();
  let state = parent;
  let rest = value;
  let restOffset = offset;
  const variable = /^\$[A-Za-z]+/.exec(trimmed);
  if (variable && variables) {
    const name = variable[0];
    if (name === '$archetype') state = roots.archetype;
    else if (name === '$composition') state = roots.composition;
    else if (name === '$openehrRoot' || name === '$openEHRRoot') state = openehrRoot;
    else return { base: parent, steps: [], result: name === '$reference' ? parent : UNKNOWN_OPENEHR };
    rest = value.slice(name.length);
    restOffset = offset + name.length;
  } else if (variable) {
    if (variable[0] !== '$openehrRoot' && variable[0] !== '$openEHRRoot' && variable[0] !== '$archetype') return { base: parent, steps: [], result: UNKNOWN_OPENEHR };
    if (variable[0] === '$archetype') state = roots.archetype;
    rest = value.slice(variable[0].length);
    restOffset = offset + variable[0].length;
  }
  const base = state;
  const steps: Step<OpenEhrState>[] = [];
  let problem: Problem | undefined;
  if (rest.startsWith('|')) return { base, steps, result: UNKNOWN_OPENEHR };
  for (const part of openEhrSteps(rest, restOffset)) {
    const span = { start: part.start, end: part.start + part.text.length };
    if (part.text === '') {
      steps.push({ text: '', span, before: state, after: state });
      break;
    }
    const pipe = part.text.indexOf('|');
    if (pipe >= 0) {
      // `value|code`: a flat path suffix the engine understands; only the attribute before it is checked
      const outcome = openEhrStep(state, { ...part, text: part.text.slice(0, pipe), attribute: part.attribute.split('|')[0] });
      steps.push({ text: part.text, span, before: state, after: UNKNOWN_OPENEHR });
      if (outcome.problem) problem = { ...span, severity: 'warning', code: outcome.code!, message: outcome.problem };
      state = UNKNOWN_OPENEHR;
      break;
    }
    const outcome = openEhrStep(state, part);
    steps.push({ text: part.text, span, before: state, after: outcome.state, implicit: outcome.implicit });
    if (outcome.problem) {
      problem = { ...span, severity: 'warning', code: outcome.code!, message: outcome.problem };
      state = UNKNOWN_OPENEHR;
      break;
    }
    state = outcome.state;
  }
  return { base, steps, result: state, problem };
}

/** Follows an internal reference to the node it reuses. */
function deref(node: OptNode): OptNode | undefined {
  if (node.kind !== 'internal-ref' || !node.targetPath || !node.owner) return node;
  let current: OptNode[] = [node.owner];
  for (const step of openEhrSteps(node.targetPath)) {
    current = current.flatMap((n) => n.attributes.get(step.attribute)?.children ?? []).filter((c) => !step.code || c.nodeId === step.code);
  }
  return current[0];
}

function matchesCode(node: OptNode, code: string): boolean {
  return node.kind === 'root' ? node.archetypeId === code : node.nodeId === code;
}

function slotAccepts(node: OptNode, code: string): boolean {
  if (node.kind !== 'slot') return false;
  if (!code.startsWith('openEHR-')) return false;
  if (!node.includes?.length) return true;
  return node.includes.some((pattern) => {
    try {
      return new RegExp(`^(?:${pattern})$`).test(code);
    } catch {
      return true;
    }
  });
}

function nodeLabel(nodes: OptNode[]): string {
  const node = nodes[0];
  if (!node) return '';
  const name = node.label ? `${node.label} (${node.rmType})` : node.rmType;
  return nodes.length > 1 ? `${name} and ${nodes.length - 1} more` : name;
}

function openEhrStep(state: OpenEhrState, step: OpenEhrStep): { state: OpenEhrState; problem?: string; code?: string; implicit?: string } {
  const path = `${state.path}/${step.text}`;
  if (!state.known) return { state: { ...UNKNOWN_OPENEHR, path } };
  if (!step.attribute) return { state: { ...UNKNOWN_OPENEHR, path } };

  const direct = attributeStep(state, step, path);
  if (direct.state.known || direct.unsure) return direct;
  // the engine steps into the value of an ELEMENT, and into the code of a coded text, on its own
  let hop: OpenEhrState = state;
  const hops: string[] = [];
  for (let i = 0; i < 2; i++) {
    const via = [...new Set(hopTypes(hop).map((t) => IMPLICIT[t]).filter(Boolean))];
    if (via.length !== 1) break;
    const next = attributeStep(hop, { ...step, text: via[0], attribute: via[0], predicate: undefined, code: undefined, name: undefined }, path);
    if (!next.state.known) break;
    hops.push(via[0]);
    hop = next.state;
    const attempt = attributeStep(hop, step, path);
    if (attempt.state.known || attempt.unsure) return { ...attempt, implicit: hops.join('/') };
  }
  return direct;
}

function hopTypes(state: OpenEhrState): string[] {
  return state.nodes.length > 0 ? state.nodes.map((n) => n.rmType) : state.rmTypes;
}

function attributeStep(state: OpenEhrState, step: OpenEhrStep, path: string): { state: OpenEhrState; problem?: string; code?: string; unsure?: boolean } {
  const attribute = step.attribute;
  const nodes: OptNode[] = [];
  const rmTypes: string[] = [];
  let rmFound: RmAttribute | undefined;
  let constrained = false;
  let unsure = false;
  const types = new Set<string>();

  for (const raw of state.nodes) {
    const node = deref(raw);
    if (!node) {
      unsure = true;
      continue;
    }
    types.add(node.rmType);
    const constraint = node.attributes.get(attribute);
    const children = constraint?.children.map((c) => (c.kind === 'internal-ref' ? deref(c) : c)).filter(isDefined) ?? [];
    if (constraint && children.length > 0) {
      constrained = true;
      if (!step.code) {
        nodes.push(...children.filter((c) => c.kind !== 'slot'));
        if (children.some((c) => c.kind === 'slot')) unsure = true;
        continue;
      }
      const matching = children.filter((c) => matchesCode(c, step.code!));
      if (matching.length > 0) {
        const named = step.name ? matching.filter((c) => c.label === step.name) : [];
        nodes.push(...(named.length > 0 ? named : matching));
      } else if (children.some((c) => slotAccepts(c, step.code!))) {
        unsure = true;
      }
      continue;
    }
    if (!isRmClass(node.rmType)) {
      unsure = true;
      continue;
    }
    const rm = rmAttribute(node.rmType, attribute);
    if (rm) {
      rmFound = rm;
      rmTypes.push(rm.type);
    }
  }
  if (state.nodes.length === 0) {
    for (const type of state.rmTypes) {
      types.add(type);
      if (!isRmClass(type)) {
        unsure = true;
        continue;
      }
      const rm = rmAttribute(type, attribute);
      if (rm) {
        rmFound = rm;
        rmTypes.push(rm.type);
      }
    }
  }

  if (nodes.length > 0) return { state: { known: true, nodes, rmTypes: rmTypesOf(nodes), path } };
  if (unsure) return { state: { ...UNKNOWN_OPENEHR, path }, unsure: true };
  // a predicate on a part the template does not constrain cannot be checked
  if (rmTypes.length > 0) return { state: { known: !step.predicate, nodes: [], rmTypes: [...new Set(rmTypes)], rmAttribute: rmFound, path }, unsure: !!step.predicate };
  if (constrained) {
    const what = step.name ? `[${step.code}, '${step.name}']` : `[${step.code}]`;
    return {
      state: UNKNOWN_OPENEHR,
      problem: `No node \`${what}\` in \`${attribute}\` of ${nodeLabel(state.nodes)} in the template${templateNames(state.nodes)}.`,
      code: 'unknown-openehr-node',
    };
  }
  return {
    state: UNKNOWN_OPENEHR,
    problem: `\`${attribute}\` is not an attribute of ${[...types].map((t) => `\`${t}\``).join(' | ')}.`,
    code: 'unknown-rm-attribute',
  };
}

function templateNames(nodes: OptNode[]): string {
  const ids = [...new Set(nodes.map((n) => n.template.id))];
  return ids.length === 1 ? ` \`${ids[0]}\`` : `s ${ids.map((id) => `\`${id}\``).join(', ')}`;
}

