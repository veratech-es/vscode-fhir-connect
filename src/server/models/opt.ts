/*
 * openEHR operational templates (OPT 1.4 XML) as trees of constrained nodes, with the labels and
 * descriptions of the archetypes they contain.
 */

import { child, children, childText, parseXml, xsiType, type XmlElement } from './xml';

export interface Interval {
  min: number;
  /** undefined when unbounded */
  max: number | undefined;
}

export interface OptNode {
  rmType: string;
  /** `at0001`; empty for unnamed nodes */
  nodeId: string;
  /** set on archetype roots, e.g. `openEHR-EHR-CLUSTER.address.v1` */
  archetypeId?: string;
  kind: 'object' | 'root' | 'slot' | 'internal-ref' | 'primitive';
  occurrences: Interval;
  attributes: Map<string, OptAttribute>;
  /** name from the template when it renames the node, otherwise the archetype term */
  label?: string;
  description?: string;
  /** archetype root the node belongs to */
  owner?: OptNode;
  parent?: OptAttribute;
  /** for internal references: the path of the referenced node in its archetype */
  targetPath?: string;
  /** for slots: the archetype ids the slot accepts, as patterns */
  includes?: string[];
  /** for primitive nodes: the allowed strings */
  values?: string[];
  offset: number;
  template: Template;
}

export interface OptAttribute {
  name: string;
  multiple: boolean;
  existence: Interval;
  children: OptNode[];
  owner: OptNode;
}

export interface Template {
  id: string;
  uri: string;
  concept?: string;
  language?: string;
  root: OptNode;
  /** every archetype root in the template, by archetype id */
  archetypes: Map<string, OptNode[]>;
  /** offset of `<template_id>` in the file */
  idOffset: number;
}

/** Reads an operational template; returns undefined for XML that is not one. */
export function parseOpt(uri: string, text: string): Template | undefined {
  let xml: XmlElement;
  try {
    xml = parseXml(text);
  } catch {
    return undefined;
  }
  if (!/(^|:)template$/.test(xml.name)) return undefined;
  const definition = child(xml, 'definition');
  const id = childText(child(xml, 'template_id'), 'value');
  if (!definition || !id) return undefined;
  const template = {
    id,
    uri,
    concept: childText(xml, 'concept'),
    language: childText(child(xml, 'language'), 'code_string'),
    archetypes: new Map(),
    idOffset: child(xml, 'template_id')!.offset,
  } as Template;
  template.root = readNode(definition, template, undefined, undefined);
  return template;
}

function readNode(element: XmlElement, template: Template, owner: OptNode | undefined, parent: OptAttribute | undefined): OptNode {
  const type = xsiType(element);
  const archetypeId = childText(child(element, 'archetype_id'), 'value');
  const isRoot = type === 'C_ARCHETYPE_ROOT' || (!owner && !!archetypeId);
  const node: OptNode = {
    rmType: childText(element, 'rm_type_name') ?? '',
    nodeId: childText(element, 'node_id') ?? '',
    kind: isRoot ? 'root' : type === 'ARCHETYPE_SLOT' ? 'slot' : type === 'ARCHETYPE_INTERNAL_REF' ? 'internal-ref' : type === 'C_PRIMITIVE_OBJECT' ? 'primitive' : 'object',
    occurrences: interval(child(element, 'occurrences')),
    attributes: new Map(),
    offset: element.offset,
    template,
    parent,
  };
  if (isRoot && archetypeId) {
    node.archetypeId = archetypeId;
    const roots = template.archetypes.get(archetypeId) ?? [];
    roots.push(node);
    template.archetypes.set(archetypeId, roots);
  }
  node.owner = isRoot ? node : owner;
  if (node.kind === 'primitive') {
    const values = children(child(element, 'item'), 'list').map((l) => l.text.trim());
    if (values.length) node.values = values;
  }
  if (node.kind === 'internal-ref') node.targetPath = childText(element, 'target_path');
  if (node.kind === 'slot') {
    node.includes = children(element, 'includes').flatMap((include) => slotPatterns(include));
  }
  for (const attributeElement of children(element, 'attributes')) {
    const attribute: OptAttribute = {
      name: childText(attributeElement, 'rm_attribute_name') ?? '',
      multiple: xsiType(attributeElement) === 'C_MULTIPLE_ATTRIBUTE',
      existence: interval(child(attributeElement, 'existence')),
      children: [],
      owner: node,
    };
    attribute.children = children(attributeElement, 'children').map((c) => readNode(c, template, node.owner, attribute));
    node.attributes.set(attribute.name, attribute);
  }
  if (isRoot) applyTerms(node, element);
  node.label ??= nameConstraint(node);
  return node;
}

function interval(element: XmlElement | undefined): Interval {
  if (!element) return { min: 1, max: 1 };
  const lower = Number(childText(element, 'lower') ?? '0');
  const unbounded = childText(element, 'upper_unbounded') === 'true';
  const upper = childText(element, 'upper');
  return { min: lower, max: unbounded || upper === undefined ? undefined : Number(upper) };
}

/** The archetype id patterns of a slot's `includes`, e.g. `openEHR-EHR-CLUSTER\.address\.v1`. */
function slotPatterns(include: XmlElement): string[] {
  const patterns: string[] = [];
  const visit = (element: XmlElement) => {
    if (element.name.endsWith('pattern')) patterns.push(element.text.trim());
    element.children.forEach(visit);
  };
  visit(include);
  return patterns;
}

/** Labels and descriptions from the archetype's term definitions, for the root and the nodes it owns. */
function applyTerms(root: OptNode, element: XmlElement): void {
  const terms = new Map<string, { text?: string; description?: string }>();
  for (const definition of children(element, 'term_definitions')) {
    const code = definition.attributes.code;
    if (!code) continue;
    const entry: { text?: string; description?: string } = {};
    for (const item of children(definition, 'items')) {
      if (item.attributes.id === 'text') entry.text = item.text.trim();
      if (item.attributes.id === 'description') entry.description = item.text.trim();
    }
    terms.set(code, entry);
  }
  const visit = (node: OptNode) => {
    if (node.owner !== root) return;
    const term = terms.get(node === root ? 'at0000' : node.nodeId);
    if (term) {
      node.label = nameConstraint(node) ?? term.text;
      node.description = term.description;
    }
    for (const attribute of node.attributes.values()) attribute.children.forEach(visit);
  };
  visit(root);
}

/** The fixed name a template gives a node through a `name/value` constraint. */
function nameConstraint(node: OptNode): string | undefined {
  const value = node.attributes.get('name')?.children[0]?.attributes.get('value')?.children[0];
  return value?.values?.length === 1 ? value.values[0] : undefined;
}
