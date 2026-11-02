/*
 * The mapping context of the cursor position: the method under the cursor with its resolved paths and
 * the extension methods that change it, and how the file fits in the project (the model it extends,
 * its extensions, the slots and contexts that use it, the templates of its archetype). For a context
 * file, what the context loads.
 */

import { isMap, isSeq, type Node, type YAMLMap } from 'yaml';
import type { ModelIndex } from './models';
import type { FhirState, OpenEhrState, PathResolver } from './paths/resolver';
import { mapAt, scalarAt, valueAt, REF_TARGET, type FileEntry, type RefKind, type Span, type WorkspaceIndex } from './workspace';

export type ContextNodeKind =
  | 'method'
  | 'fhir'
  | 'openehr'
  | 'model'
  | 'extension'
  | 'context'
  | 'template'
  | 'profile'
  | 'group'
  | 'missing';

export interface ContextNode {
  label: string;
  description?: string;
  tooltip?: string;
  kind: ContextNodeKind;
  /** where a click goes: a mapping file at an offset, or a template / StructureDefinition */
  target?: { uri: string; offset: number; model?: boolean };
  children?: ContextNode[];
}

export interface MappingContextInput {
  index: WorkspaceIndex;
  models: ModelIndex;
  resolver: PathResolver;
}

/** The context tree for `offset` in `entry`. */
export function mappingContext({ index, models, resolver }: MappingContextInput, entry: FileEntry, offset: number): ContextNode[] {
  const nodes: ContextNode[] = [];
  if (entry.fileType === 'context') {
    nodes.push(...contextFile(index, models, entry));
    return nodes;
  }
  const chain = methodChain(entry, offset);
  if (chain.length > 0) nodes.push(methodNode(index, resolver, entry, chain));
  nodes.push(fileNode(index, models, entry));
  return nodes;
}

// ---------------------------------------------------------------------------------------------
// The method under the cursor

interface ChainLink {
  map: YAMLMap;
  name: string;
  span?: Span;
}

/** The methods from the top level down to the innermost one that contains `offset`. */
function methodChain(entry: FileEntry, offset: number): ChainLink[] {
  const root = entry.doc.yaml.contents;
  if (!isMap(root)) return [];
  const chain: ChainLink[] = [];
  let level = methodsOf(valueAt(root, 'mappings'));
  for (;;) {
    const found = level.find((m) => m.range && offset >= m.range[0] && offset <= m.range[1]);
    if (!found) break;
    const name = scalarAt(found, 'name');
    chain.push({ map: found, name: name?.value ?? '(unnamed)', span: name?.span });
    level = [...methodsOf(valueAt(mapAt(found, 'followedBy'), 'mappings')), ...methodsOf(valueAt(mapAt(found, 'reference'), 'mappings'))];
  }
  return chain;
}

function methodsOf(list: Node | null | undefined): YAMLMap[] {
  return isSeq(list) ? (list.items as Node[]).filter(isMap) : [];
}

function methodNode(index: WorkspaceIndex, resolver: PathResolver, entry: FileEntry, chain: ChainLink[]): ContextNode {
  const method = chain[chain.length - 1];
  const path = chain.map((c) => c.name).join('.');
  const children: ContextNode[] = [];
  const context = resolver.resolve(entry).methods.get(method.map);
  if (context) {
    children.push(fhirNode(context.self.fhir), openEhrNode(context.self.openehr));
  }
  for (const key of ['slotArchetype', 'slotContext'] as const) {
    const slot = scalarAt(method.map, key);
    if (!slot) continue;
    const targets = index.resolve(slot.value, entry, REF_TARGET[key]);
    children.push(
      targets.length
        ? { ...fileLink(targets[0]), description: `${key === 'slotContext' ? 'sub-context' : 'slot'} · ${fileDescription(targets[0])}` }
        : missing(slot.value, `no ${REF_TARGET[key]} mapping with this name`),
    );
  }
  if (entry.fileType === 'extension') {
    const target = extendedMethod(index, entry, chain);
    if (target) children.push(target);
  } else {
    const changes = extensionMethodsOf(index, entry, path);
    if (changes.length) children.push({ label: 'Changed by', kind: 'group', description: String(changes.length), children: changes });
  }
  return {
    label: chain.map((c) => c.name).join(' › '),
    description: 'method',
    kind: 'method',
    target: method.span ? { uri: entry.uri, offset: method.span.start } : undefined,
    children,
  };
}

function fhirNode(state: FhirState): ContextNode {
  if (!state.known) return { label: 'FHIR', description: 'not resolved', kind: 'fhir' };
  const repeats = state.element && state.element.max !== '1' ? '[]' : '';
  return {
    label: state.path || state.types.join(' | '),
    description: `FHIR · ${state.types.join(' | ')}${repeats}`,
    tooltip: state.element?.short,
    kind: 'fhir',
  };
}

function openEhrNode(state: OpenEhrState): ContextNode {
  if (!state.known) return { label: 'openEHR', description: 'not resolved', kind: 'openehr' };
  const node = state.nodes[0];
  const what = node ? `${node.label ? `${node.label} · ` : ''}${node.rmType}` : state.rmTypes.join(' | ');
  const templates = [...new Set(state.nodes.map((n) => n.template.id))];
  return {
    label: state.path,
    description: `openEHR · ${what}`,
    tooltip: templates.length ? `In ${templates.join(', ')}` : undefined,
    kind: 'openehr',
    target: node ? { uri: node.template.uri, offset: node.offset, model: true } : undefined,
  };
}

/** For a method of an extension file: the model method it changes, or where it is added. */
function extendedMethod(index: WorkspaceIndex, entry: FileEntry, chain: ChainLink[]): ContextNode | undefined {
  const top = chain[0].map;
  const mode = scalarAt(top, 'extension')?.value;
  const [model] = entry.extends ? index.resolve(entry.extends, entry, 'model') : [];
  if (!model) return entry.extends ? missing(entry.extends, 'extended model not found') : undefined;
  if (mode === 'add' || !mode) return { ...fileLink(model), description: `${mode ?? 'no extension mode'} · added to the model` };
  const name = mode === 'append' ? scalarAt(top, 'appendTo')?.value : scalarAt(top, 'name')?.value;
  const target = model.methods.find((m) => (mode === 'append' ? m.path === name : m.path.split('.').pop() === name));
  if (!target) return missing(name ?? '?', `no method to ${mode} in ${model.name}`);
  return {
    label: `${model.name} › ${target.path.replace(/\./g, ' › ')}`,
    description: mode === 'append' ? 'appends to' : 'overwrites',
    kind: 'method',
    target: { uri: model.uri, offset: target.span.start },
  };
}

/** Extension methods, in any extension of `model`, that overwrite or append to the method at `path`. */
function extensionMethodsOf(index: WorkspaceIndex, model: FileEntry, path: string): ContextNode[] {
  const name = path.split('.').pop();
  const nodes: ContextNode[] = [];
  for (const extension of extensionsOf(index, model)) {
    const root = extension.doc.yaml.contents;
    if (!isMap(root)) continue;
    for (const method of methodsOf(valueAt(root, 'mappings'))) {
      const mode = scalarAt(method, 'extension')?.value;
      const own = scalarAt(method, 'name');
      const hit = (mode === 'overwrite' && own?.value === name) || (mode === 'append' && scalarAt(method, 'appendTo')?.value === path);
      if (!hit) continue;
      nodes.push({
        label: `${extension.name} › ${own?.value ?? '(unnamed)'}`,
        description: mode,
        kind: 'extension',
        target: { uri: extension.uri, offset: own?.span.start ?? 0 },
      });
    }
  }
  return nodes;
}

function extensionsOf(index: WorkspaceIndex, model: FileEntry): FileEntry[] {
  return [...index.all()]
    .filter((e) => e.fileType === 'extension' && e.extends && index.resolve(e.extends, e, 'model').includes(model))
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
}

// ---------------------------------------------------------------------------------------------
// The file in the project

function fileNode(index: WorkspaceIndex, models: ModelIndex, entry: FileEntry): ContextNode {
  const children: ContextNode[] = [];
  if (entry.fileType === 'extension' && entry.extends) {
    const [model] = index.resolve(entry.extends, entry, 'model');
    children.push(model ? { ...fileLink(model), description: `extends · ${fileDescription(model)}` } : missing(entry.extends, 'extended model not found'));
  }
  if (entry.fileType === 'model') {
    children.push(...modelSpec(models, entry));
    const extensions = extensionsOf(index, entry);
    if (extensions.length) children.push(group('Extensions', extensions.map(fileLink)));
  }
  const usages = index.usages(entry);
  const slots = usages.filter((u) => u.ref.kind === 'slotArchetype');
  if (slots.length) {
    children.push(
      group(
        'Used as slot by',
        slots.map((u) => ({
          label: `${u.entry.name ?? '?'} › ${methodPathAt(u.entry, u.ref.span.start) ?? 'slot'}`,
          kind: 'method' as const,
          target: { uri: u.entry.uri, offset: u.ref.span.start },
        })),
      ),
    );
  }
  const contexts = [...new Set(usages.filter((u) => u.entry.fileType === 'context').map((u) => u.entry))];
  if (contexts.length) {
    children.push(
      group(
        'Contexts',
        contexts.map((c) => ({
          ...fileLink(c),
          description: usages.filter((u) => u.entry === c).map((u) => roleIn(u.ref.kind)).join(', '),
          children: contextFile(index, models, c),
        })),
      ),
    );
  } else if (entry.fileType === 'model' && slots.length === 0) {
    children.push({ label: 'No context or slot uses this mapping', kind: 'missing' });
  }
  return { ...fileLink(entry), description: entry.fileType ?? 'mapping', children };
}

function modelSpec(models: ModelIndex, entry: FileEntry): ContextNode[] {
  const nodes: ContextNode[] = [];
  const spec = mapAt(entry.doc.yaml.contents as YAMLMap, 'spec');
  const url = scalarAt(mapAt(spec, 'fhirConfig'), 'structureDefinition')?.value;
  if (url) nodes.push(profileNode(models, url, 'structureDefinition'));
  if (entry.archetypeId) {
    const templates = [...new Set(models.archetypeRoots(entry.archetypeId).map((n) => n.template))];
    nodes.push({
      label: entry.archetypeId,
      description: templates.length ? `archetype · in ${templates.length} template${templates.length > 1 ? 's' : ''}` : 'archetype · in no template of the workspace',
      kind: 'openehr',
      children: templates.map((t) => ({
        label: t.id,
        description: 'template',
        kind: 'template' as const,
        target: { uri: t.uri, offset: models.archetypeRoots(entry.archetypeId!).find((n) => n.template === t)?.offset ?? t.idOffset, model: true },
      })),
    });
  }
  return nodes;
}

function roleIn(kind: RefKind): string {
  return { archetypes: 'archetype', extensions: 'extension', start: 'start', operational: 'operational', contexts: 'sub-context', slotContext: 'slot' }[
    kind as string
  ] ?? kind;
}

// ---------------------------------------------------------------------------------------------
// Context files

function contextFile(index: WorkspaceIndex, models: ModelIndex, entry: FileEntry): ContextNode[] {
  const root = entry.doc.yaml.contents;
  const context = isMap(root) ? mapAt(root, 'context') : undefined;
  if (!context) return [];
  const nodes: ContextNode[] = [];
  const scope = scalarAt(context, 'scope')?.value;
  if (scope) nodes.push({ label: `scope: ${scope}`, kind: 'group' });
  const templateId = scalarAt(mapAt(context, 'template'), 'id')?.value;
  if (templateId) {
    const [template] = models.templateById(templateId);
    nodes.push(
      template
        ? { label: templateId, description: 'template', kind: 'template', target: { uri: template.uri, offset: template.idOffset, model: true } }
        : missing(templateId, 'template not in the workspace'),
    );
  }
  const profile = scalarAt(mapAt(context, 'profile'), 'url')?.value;
  if (profile) nodes.push(profileNode(models, profile, 'profile'));
  for (const ref of entry.references.filter((r) => r.kind === 'start')) {
    const [target] = index.resolve(ref.value, entry, 'model');
    nodes.push(target ? { ...fileLink(target), description: `start · ${fileDescription(target)}` } : missing(ref.value, 'start model not found'));
  }
  for (const [kind, label] of [
    ['archetypes', 'Archetypes'],
    ['extensions', 'Extensions'],
    ['contexts', 'Sub-contexts'],
    ['operational', 'Operational'],
  ] as const) {
    const refs = entry.references.filter((r) => r.kind === kind);
    if (!refs.length) continue;
    nodes.push(
      group(
        label,
        refs.map((ref) => {
          const [target] = index.resolve(ref.value, entry, REF_TARGET[kind]);
          if (!target) return missing(ref.value, `no ${REF_TARGET[kind]} mapping with this name`);
          const extended = target.fileType === 'extension' && target.extends ? ` · extends ${target.extends}` : '';
          return { ...fileLink(target), description: `${fileDescription(target)}${extended}` };
        }),
      ),
    );
  }
  const users = index.usages(entry).filter((u) => u.ref.kind === 'contexts' || u.ref.kind === 'slotContext');
  if (users.length) {
    nodes.push(
      group(
        'Entered from',
        users.map((u) => ({
          label: u.ref.kind === 'slotContext' ? `${u.entry.name ?? '?'} › ${methodPathAt(u.entry, u.ref.span.start) ?? 'slot'}` : u.entry.name ?? '?',
          description: u.ref.kind === 'slotContext' ? 'slotContext' : 'contexts',
          kind: u.ref.kind === 'slotContext' ? ('method' as const) : ('context' as const),
          target: { uri: u.entry.uri, offset: u.ref.span.start },
        })),
      ),
    );
  }
  return nodes;
}

function profileNode(models: ModelIndex, url: string, role: string): ContextNode {
  const typed = models.typeForUrl(url);
  return {
    label: url,
    description: typed ? `${role} · ${typed.type}` : `${role} · not in the workspace`,
    kind: 'profile',
    target: typed?.profile ? { uri: typed.profile.uri, offset: typed.profile.urlOffset, model: true } : undefined,
  };
}

// ---------------------------------------------------------------------------------------------

function fileLink(entry: FileEntry): ContextNode {
  return {
    label: entry.name ?? entry.uri.split('/').pop()!,
    kind: entry.fileType ?? 'model',
    target: { uri: entry.uri, offset: entry.nameSpan?.start ?? 0 },
  };
}

function fileDescription(entry: FileEntry): string {
  return entry.fileType ?? 'mapping';
}

function group(label: string, children: ContextNode[]): ContextNode {
  return { label, description: String(children.length), kind: 'group', children };
}

function missing(label: string, why: string): ContextNode {
  return { label, description: why, kind: 'missing' };
}

/** `parent.child` path of the method that contains `offset`. */
function methodPathAt(entry: FileEntry, offset: number): string | undefined {
  const chain = methodChain(entry, offset);
  return chain.length ? chain.map((c) => c.name).join(' › ') : undefined;
}
