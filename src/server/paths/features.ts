/*
 * Hover, inlay hints, completion and Go to Definition for the paths of mapping files, on top of
 * the resolutions made by PathResolver.
 */

import { isMap, isSeq, type Node, type YAMLMap } from 'yaml';
import { CompletionItemKind, type CompletionItem } from 'vscode-languageserver';
import { fhirElements } from '../models/fhir';
import type { ModelIndex } from '../models';
import type { OptNode } from '../models/opt';
import { rmAttributes } from '../models/rm';
import { scalarAt } from '../workspace';
import type { FcDocument } from '../document';
import { resolveFhirPath, resolveOpenEhrPath, type Context, type FhirState, type FileResolution, type OpenEhrState, type PathSide, type PathSite, type Step } from './resolver';

export interface Target {
  uri: string;
  offset: number;
}

export function siteAt(resolution: FileResolution, offset: number): PathSite | undefined {
  return resolution.sites.find((s) => offset >= s.span.start && offset <= s.span.end);
}

function stepAt(site: PathSite, offset: number): Step<FhirState | OpenEhrState> | undefined {
  return site.steps.find((s) => offset >= s.span.start && offset <= s.span.end && s.text !== '');
}

function isFhir(state: FhirState | OpenEhrState): state is FhirState {
  return 'types' in state;
}

function interval(min: number, max: number | undefined | string): string {
  return `${min}..${max === undefined ? '*' : max}`;
}

function nodeSummary(node: OptNode): string {
  const code = node.kind === 'root' ? node.archetypeId : node.nodeId;
  const lines = [`**${node.label ?? node.rmType}** · \`${node.rmType}\` · ${interval(node.occurrences.min, node.occurrences.max)}`];
  if (node.description && node.description !== node.label && !/^@\s*internal\s*@$/.test(node.description)) lines.push(node.description);
  const archetype = node.owner?.archetypeId;
  const where = [code && `\`${code}\``, archetype && node.kind !== 'root' && `in \`${archetype}\``].filter(Boolean).join(' ');
  lines.push([where, `template \`${node.template.id}\``].filter(Boolean).join(' · '));
  return lines.join('\n\n');
}

function fhirSummary(state: FhirState): string {
  const element = state.element;
  const types = state.types.map((t) => `\`${t}\``).join(' | ');
  if (!element) return `${types}`;
  const head = `**${state.elementPath}** · ${types} · ${interval(element.min, element.max)}`;
  return element.short ? `${head}\n\n${element.short}` : head;
}

/** Markdown for the step of a path under the cursor, with the path it resolves to. */
export function pathHover(site: PathSite, offset: number): { markdown: string; start: number; end: number } | undefined {
  const step = stepAt(site, offset);
  const state = step ? step.after : site.result;
  const span = step ? step.span : site.span;
  if (!state.known) return undefined;
  const parts: string[] = [];
  if (isFhir(state)) {
    parts.push(fhirSummary(state));
  } else if (state.nodes.length > 0) {
    const shown = state.nodes.slice(0, 3).map(nodeSummary);
    if (state.nodes.length > 3) shown.push(`… and ${state.nodes.length - 3} more`);
    parts.push(shown.join('\n\n---\n\n'));
  } else if (state.rmAttribute) {
    const a = state.rmAttribute;
    parts.push(`**${a.name}** · \`${a.type}\`${a.multiple ? ' (list)' : ''} · attribute of \`${a.declaredIn}\` in the openEHR RM`);
  } else {
    parts.push(state.rmTypes.map((t) => `\`${t}\``).join(' | '));
  }
  if (step?.implicit) parts.push(`Reached through \`${step.implicit}\`, which the engine adds on its own.`);
  parts.push(`\`${state.path}\``);
  return { markdown: parts.join('\n\n'), ...span };
}

/** A short label after each `with` path: what the openEHR path is, and the FHIR type. */
export function pathInlayHints(doc: FcDocument, resolution: FileResolution): { offset: number; label: string }[] {
  const hints: { offset: number; label: string }[] = [];
  for (const site of resolution.sites) {
    if (!site.key.startsWith('with.') || site.problem || !site.result.known) continue;
    const state = site.result;
    let label: string | undefined;
    if (isFhir(state)) {
      if (site.value.trim().startsWith('$') && !site.value.includes('.')) continue;
      label = state.types.join(' | ');
      if (state.element && state.element.max !== '1') label += '[]';
    } else if (state.nodes.length > 0) {
      const node = state.nodes[0];
      label = node.label ? `${node.label} · ${node.rmType}` : node.rmType;
    } else if (state.rmTypes.length > 0) {
      label = state.rmTypes.join(' | ');
    }
    // after the closing quote, if there is one
    const quote = doc.text[site.span.end] === '"' || doc.text[site.span.end] === "'" ? 1 : 0;
    if (label) hints.push({ offset: site.span.end + quote, label });
  }
  return hints;
}

/** The template nodes or profile a path step stands for. */
export function pathDefinitions(site: PathSite, offset: number): Target[] {
  const step = stepAt(site, offset);
  const state = step ? step.after : site.result;
  if (!state.known || isFhir(state)) return [];
  return state.nodes.map((node) => ({ uri: node.template.uri, offset: node.offset }));
}

/**
 * The nodes of the ADL archetypes a path step stands for. An RM attribute past the constrained nodes
 * goes to the last node before it; a node without a code, to its nearest coded ancestor.
 */
export function archetypeDefinitions(site: PathSite, offset: number, models: ModelIndex): Target[] {
  const step = stepAt(site, offset);
  const states = step ? site.steps.slice(0, site.steps.indexOf(step) + 1).map((s) => s.after).reverse() : [site.result, ...site.steps.map((s) => s.after).reverse()];
  const state = [...states, site.base].find((s) => s.known && !isFhir(s) && s.nodes.length > 0) as OpenEhrState | undefined;
  return state ? adlTargets(state.nodes, models) : [];
}

/** The ADL archetype root of `spec.openEhrConfig.archetype`. */
export function archetypeFileAt(doc: FcDocument, models: ModelIndex, offset: number): Target[] {
  const root = doc.yaml.contents;
  if (!isMap(root)) return [];
  const spec = root.get('spec');
  const config = isMap(spec) ? spec.get('openEhrConfig') : undefined;
  const archetype = isMap(config) ? scalarAt(config as YAMLMap, 'archetype') : undefined;
  if (!archetype || offset < archetype.span.start || offset > archetype.span.end) return [];
  return models.archetypeFiles(archetype.value.trim()).map((a) => ({ uri: a.uri, offset: a.rootOffset }));
}

function adlTargets(nodes: OptNode[], models: ModelIndex): Target[] {
  const targets = new Map<string, Target>();
  for (let node of nodes) {
    while (node.kind !== 'root' && !/^at[0-9]/.test(node.nodeId) && node.parent?.owner) node = node.parent.owner;
    const id = node.kind === 'root' ? node.archetypeId : node.owner?.archetypeId;
    if (!id) continue;
    for (const archetype of models.archetypeFiles(id)) {
      const offset = node.kind === 'root' ? archetype.rootOffset : archetype.nodes.get(node.nodeId) ?? archetype.rootOffset;
      targets.set(`${archetype.uri}#${offset}`, { uri: archetype.uri, offset });
    }
  }
  return [...targets.values()];
}

// ---------------------------------------------------------------------------------------------
// Completion

/** Maps from the root of the document to the innermost one that contains `offset`. */
function mapsAt(doc: FcDocument, offset: number): YAMLMap[] {
  const chain: YAMLMap[] = [];
  const visit = (node: Node | null | undefined): void => {
    if (!node || !node.range) return;
    const [start, , end] = node.range;
    if (offset < start || offset > end) return;
    if (isMap(node)) {
      chain.push(node);
      for (const pair of node.items) visit(pair.value as Node);
    } else if (isSeq(node)) {
      for (const item of node.items as Node[]) visit(item);
    }
  };
  visit(doc.yaml.contents as Node);
  return chain;
}

interface PathSlot {
  side: PathSide;
  /** state the typed path starts from */
  parent: Context;
  /** what `$openehrRoot` stands for */
  openehrRoot: OpenEhrState;
  variables: boolean;
}

/** Works out which path is being typed at `offset` and where it starts from. */
function slotAt(doc: FcDocument, resolution: FileResolution, offset: number, key: string): PathSlot | undefined {
  const chain = mapsAt(doc, offset);
  const methodIndex = chain.map((m) => resolution.methods.has(m)).lastIndexOf(true);
  if (methodIndex < 0) return undefined;
  const method = chain[methodIndex];
  const { self, parent } = resolution.methods.get(method)!;
  const inner = chain.slice(methodIndex + 1);
  const holder = inner[inner.length - 1];
  const holderKey = holder ? keyOf(chain[chain.indexOf(holder) - 1], holder) : undefined;

  if (holderKey === 'with' && (key === 'fhir' || key === 'openehr')) {
    return { side: key, parent, openehrRoot: parent.openehr, variables: true };
  }
  const inManual = inner.some((m) => isManualEntry(method, m));
  if (holderKey === 'fhirCondition' || holderKey === 'openehrCondition') {
    const side: PathSide = holderKey === 'fhirCondition' ? 'fhir' : 'openehr';
    const openehrRoot = inManual ? self.openehr : parent.openehr;
    if (key === 'targetRoot') return { side, parent, openehrRoot, variables: true };
    if (key === 'targetAttribute' || key === 'targetAttributes') {
      const root = resolution.sites.find((s) => s.key === `${holderKey}.targetRoot` && within(holder, s.span.start));
      if (!root) return undefined;
      const state = root.result;
      return side === 'fhir'
        ? { side, parent: { fhir: state as FhirState, openehr: parent.openehr }, openehrRoot, variables: false }
        : { side, parent: { fhir: parent.fhir, openehr: state as OpenEhrState }, openehrRoot: state as OpenEhrState, variables: false };
    }
  }
  if (key === 'path' && holder) {
    const side = isManualPathItem(method, holder);
    if (side) return { side, parent: self, openehrRoot: self.openehr, variables: false };
  }
  return undefined;
}

function within(map: YAMLMap, offset: number): boolean {
  return !!map.range && offset >= map.range[0] && offset <= map.range[2];
}

function keyOf(parent: YAMLMap | undefined, child: YAMLMap): string | undefined {
  const pair = parent?.items.find((p) => p.value === child);
  return pair ? String((pair.key as { value?: unknown })?.value) : undefined;
}

function manualEntries(method: YAMLMap): YAMLMap[] {
  const manual = method.items.find((p) => String((p.key as { value?: unknown })?.value) === 'manual')?.value as Node | undefined;
  return isSeq(manual) ? (manual.items as Node[]).filter(isMap) : [];
}

function isManualEntry(method: YAMLMap, map: YAMLMap): boolean {
  return manualEntries(method).includes(map);
}

/** 'fhir' or 'openehr' when `item` is a `path`/`value` item of one of the method's manual entries. */
function isManualPathItem(method: YAMLMap, item: YAMLMap): PathSide | undefined {
  for (const entry of manualEntries(method)) {
    for (const side of ['fhir', 'openehr'] as const) {
      const list = entry.items.find((p) => String((p.key as { value?: unknown })?.value) === side)?.value as Node | undefined;
      if (isSeq(list) && (list.items as Node[]).includes(item)) return side;
    }
  }
  return undefined;
}

/**
 * Completion of the next step of the path being typed: template nodes and RM attributes for openEHR
 * paths, elements (and casts of choice elements) for FHIR paths.
 *
 * @param typed the value typed so far on the line, up to the cursor, and the offset it starts at
 */
export function pathCompletions(
  doc: FcDocument,
  resolution: FileResolution,
  offset: number,
  key: string,
  typed: { text: string; start: number },
): { items: CompletionItem[]; start: number; exclusive?: boolean } | undefined {
  const roots = resolution.roots;
  if (!roots) return undefined;
  const slot = slotAt(doc, resolution, offset, key);
  if (!slot) return undefined;
  const operators = !!doc.supportedGrammar?.pathOperators;
  if (/^\$[A-Za-z]*$/.test(typed.text)) return undefined; // a variable being typed; the grammar completes those

  if (slot.side === 'fhir') {
    const cast = /(?:^|\.)\s*(as|ofType)\(\s*(\w*)$/.exec(typed.text);
    if (cast) {
      // the type of a cast being typed: the types the element before it can be cast to
      const head = typed.text.slice(0, cast.index);
      const before = head === '' ? undefined : resolveFhirPath(head, typed.start, slot.parent.fhir, roots.resource, slot.variables, operators);
      if (!before || before.problem || !before.result.known) return undefined;
      return { items: castItems(before.result), start: typed.start + typed.text.length - cast[2].length, exclusive: true };
    }
    const resolved = resolveFhirPath(typed.text, typed.start, slot.parent.fhir, roots.resource, slot.variables, operators);
    const last = resolved.steps[resolved.steps.length - 1];
    const state = last ? last.before : resolved.base;
    const start = last ? last.span.start : typed.start + typed.text.length;
    if (!state.known || (resolved.problem && resolved.problem.start < start)) return undefined;
    if (!last && typed.text.trim() !== '' && !typed.text.endsWith('.')) return undefined;
    return { items: fhirItems(state), start };
  }
  const resolved = resolveOpenEhrPath(typed.text, typed.start, slot.parent.openehr, roots, slot.variables, slot.openehrRoot, operators);
  const last = resolved.steps[resolved.steps.length - 1];
  const state = last ? last.before : resolved.base;
  const start = last ? last.span.start : typed.start + typed.text.length;
  if (!state.known || (resolved.problem && resolved.problem.start < start)) return undefined;
  if (!last && typed.text.trim() !== '' && !typed.text.endsWith('/')) return undefined;
  return { items: openEhrItems(state), start };
}

function castItems(state: FhirState): CompletionItem[] {
  const types = new Set(state.types);
  for (const target of state.targets ?? []) types.add(target);
  return [...types].map((type, i) => ({
    label: type,
    kind: CompletionItemKind.Class,
    detail: state.targets?.includes(type) && !state.types.includes(type) ? `resource ${state.elementPath ?? state.path} may refer to` : `type of ${state.elementPath ?? state.path}`,
    sortText: String(i).padStart(4, '0'),
  }));
}

function fhirItems(state: FhirState): CompletionItem[] {
  const items: CompletionItem[] = [];
  const seen = new Set<string>();
  if (state.element?.choice && state.types.length > 1) {
    for (const type of state.types) {
      items.push({ label: `as(${type})`, kind: CompletionItemKind.Function, detail: `choice of ${state.elementPath}`, sortText: `0${type}` });
    }
  }
  for (const type of state.types) {
    for (const [name, element] of fhirElements(type)) {
      if (seen.has(name)) continue;
      seen.add(name);
      items.push({
        label: name,
        kind: CompletionItemKind.Field,
        detail: `${element.types.join(' | ')}${element.choice ? ' (choice)' : ''} · ${element.min}..${element.max}`,
        documentation: element.short,
        sortText: `1${String(items.length).padStart(4, '0')}`,
      });
    }
  }
  return items;
}

function openEhrItems(state: OpenEhrState): CompletionItem[] {
  const items: CompletionItem[] = [];
  const seen = new Set<string>();
  const add = (item: CompletionItem) => {
    if (seen.has(item.label)) return;
    seen.add(item.label);
    items.push({ ...item, sortText: `${item.sortText ?? '1'}${String(items.length).padStart(4, '0')}` });
  };
  for (const node of state.nodes) {
    for (const attribute of node.attributes.values()) {
      if (attribute.name === 'name') continue;
      for (const child of attribute.children) {
        if (child.kind === 'slot' || child.kind === 'primitive') continue;
        const code = child.kind === 'root' ? child.archetypeId : child.nodeId;
        if (!code) continue;
        const named = node.attributes.get(attribute.name)!.children.filter((c) => (c.kind === 'root' ? c.archetypeId : c.nodeId) === code).length > 1;
        const label = named && child.label ? `${attribute.name}[${code} and name/value='${child.label}']` : `${attribute.name}[${code}]`;
        add({
          label,
          kind: child.kind === 'root' ? CompletionItemKind.Module : CompletionItemKind.Field,
          detail: `${child.label ?? ''} · ${child.rmType}`.replace(/^ · /, ''),
          documentation: child.description,
          filterText: `${label} ${child.label ?? ''}`,
          sortText: '0',
        });
      }
    }
  }
  const types = state.nodes.length > 0 ? [...new Set(state.nodes.map((n) => n.rmType))] : state.rmTypes;
  for (const type of types) {
    for (const attribute of rmAttributes(type)) {
      if (state.nodes.some((n) => (n.attributes.get(attribute.name)?.children.length ?? 0) > 0)) continue;
      add({ label: attribute.name, kind: CompletionItemKind.Property, detail: `${attribute.type}${attribute.multiple ? ' (list)' : ''} · RM ${attribute.declaredIn}`, sortText: '1' });
    }
  }
  return items;
}

/** Hover for `context.template.id` and `fhirConfig.structureDefinition` / `context.profile.url`. */
export function modelReferenceAt(doc: FcDocument, models: ModelIndex, offset: number): { span: { start: number; end: number }; markdown: string; targets: Target[] } | undefined {
  const root = doc.yaml.contents;
  if (!isMap(root)) return undefined;
  const map = (m: YAMLMap | undefined, key: string) => {
    const value = m?.items.find((p) => String((p.key as { value?: unknown })?.value) === key)?.value;
    return isMap(value) ? (value as YAMLMap) : undefined;
  };
  const context = map(root, 'context');
  const templateId = scalarAt(map(context, 'template'), 'id');
  if (templateId && offset >= templateId.span.start && offset <= templateId.span.end) {
    const templates = models.templateById(templateId.value);
    if (templates.length === 0) return undefined;
    const t = templates[0];
    const markdown = [`**${t.concept ?? t.id}** · operational template`, `${t.archetypes.size} archetypes · language \`${t.language ?? '?'}\``].join('\n\n');
    return { span: templateId.span, markdown, targets: templates.map((x) => ({ uri: x.uri, offset: x.idOffset })) };
  }
  const urls = [scalarAt(map(map(root, 'spec'), 'fhirConfig'), 'structureDefinition'), scalarAt(map(context, 'profile'), 'url')];
  for (const url of urls) {
    if (!url || offset < url.span.start || offset > url.span.end) continue;
    const typed = models.typeForUrl(url.value);
    if (!typed) return undefined;
    const profile = typed.profile;
    const markdown = profile ? `**${profile.name ?? profile.url}** · profile of \`${typed.type}\`` : `\`${typed.type}\` · FHIR R4 core`;
    return { span: url.span, markdown, targets: profile ? [{ uri: profile.uri, offset: profile.urlOffset }] : [] };
  }
  return undefined;
}
