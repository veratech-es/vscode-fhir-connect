/*
 * ADL 1.4 archetypes (`.adl`), read only as far as Go to Archetype Definition needs: the archetype id
 * and where each node of the definition section starts.
 */

export interface Archetype {
  id: string;
  uri: string;
  /** offset of the root node of the definition, or of the archetype id when there is none */
  rootOffset: number;
  /** offset of each node, by its code (`at0004`), at its first occurrence in the definition */
  nodes: Map<string, number>;
}

const NODE = /\b[A-Z][A-Z0-9_]*\[(at[0-9]+(?:\.[0-9]+)*)\]/g;

/** Reads an ADL 1.4 archetype; returns undefined for anything else. */
export function parseAdl(uri: string, text: string): Archetype | undefined {
  const header = /^﻿?\s*archetype\b[^\n]*\n\s*([A-Za-z][\w-]*-[\w-]+-[A-Za-z_]+\.[\w-]+\.v\d+[\w.-]*)/.exec(text);
  if (!header) return undefined;
  const id = header[1];
  const definition = /^definition\b/m.exec(text);
  const end = definition ? /^(ontology|terminology)\b/m.exec(text.slice(definition.index)) : null;
  const nodes = new Map<string, number>();
  let rootOffset = header.index + header[0].length - id.length;
  if (definition) {
    const body = text.slice(definition.index, end ? definition.index + end.index : text.length);
    for (const m of body.matchAll(NODE)) {
      const offset = definition.index + m.index;
      if (nodes.size === 0) rootOffset = offset;
      if (!nodes.has(m[1])) nodes.set(m[1], offset);
    }
  }
  return { id, uri, rootOffset, nodes };
}
