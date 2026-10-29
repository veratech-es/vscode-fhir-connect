/*
 * FHIR R4 resources and data types, from the index bundled with the extension, plus the
 * StructureDefinitions found in the workspace (profiles, by their canonical URL).
 */

import core from './fhir-r4.json';

export interface FhirElement {
  types: string[];
  min: number;
  max: string;
  choice?: boolean;
  /** resource types a Reference may point at */
  targets?: string[];
  short?: string;
}

export interface FhirType {
  kind: 'resource' | 'complex' | 'primitive' | 'backbone';
  base?: string;
  abstract?: boolean;
  short?: string;
  elements: Record<string, FhirElement>;
}

const CORE = (core as unknown as { types: Record<string, FhirType> }).types;
export const CORE_PREFIX = 'http://hl7.org/fhir/StructureDefinition/';

export interface Profile {
  url: string;
  name?: string;
  /** the FHIR type the profile constrains */
  type: string;
  uri: string;
  /** offset of the `"url"` property in the file */
  urlOffset: number;
}

export function coreType(name: string): FhirType | undefined {
  return Object.prototype.hasOwnProperty.call(CORE, name) ? CORE[name] : undefined;
}

export function isResourceType(name: string): boolean {
  return coreType(name)?.kind === 'resource';
}

/** The element `name` of `type`, looking through its base types. */
export function fhirElement(type: string, name: string): FhirElement | undefined {
  for (let t: string | undefined = type; t; t = coreType(t)?.base) {
    const element = coreType(t)?.elements[name];
    if (element) return element;
  }
  return undefined;
}

/** All elements of `type`, inherited ones last. */
export function fhirElements(type: string): [string, FhirElement][] {
  const result: [string, FhirElement][] = [];
  const seen = new Set<string>();
  for (let t: string | undefined = type; t; t = coreType(t)?.base) {
    for (const [name, element] of Object.entries(coreType(t)?.elements ?? {})) {
      if (seen.has(name)) continue;
      seen.add(name);
      result.push([name, element]);
    }
  }
  return result;
}

/** True when `type` is `ancestor` or derives from it. */
export function fhirConforms(type: string, ancestor: string): boolean {
  for (let t: string | undefined = type; t; t = coreType(t)?.base) if (t === ancestor) return true;
  return false;
}

/**
 * The FHIR type a cast names. Mappings use FHIRPath type names (`dateTime`, `CodeableConcept`) as well
 * as the HAPI class names the openFHIR engine accepts (`DateTimeType`, `StringType`, `Boolean`).
 */
export function castType(name: string): string | undefined {
  if (coreType(name)) return name;
  const lower = name[0].toLowerCase() + name.slice(1);
  if (coreType(lower)?.kind === 'primitive') return lower;
  if (name.endsWith('Type')) return castType(name.slice(0, -4));
  return undefined;
}

/** Names of the types of a choice element as they appear in an element name, e.g. `valueQuantity`. */
export function choiceSuffix(type: string): string {
  return type[0].toUpperCase() + type.slice(1);
}

/** Reads a StructureDefinition JSON file; returns undefined for other JSON. */
export function parseProfile(uri: string, text: string): Profile | undefined {
  if (!/"resourceType"\s*:\s*"StructureDefinition"/.test(text)) return undefined;
  let json: { resourceType?: string; url?: unknown; name?: unknown; type?: unknown };
  try {
    json = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (json.resourceType !== 'StructureDefinition' || typeof json.url !== 'string' || typeof json.type !== 'string') return undefined;
  const urlOffset = text.search(/"url"\s*:/);
  return { url: json.url, name: typeof json.name === 'string' ? json.name : undefined, type: json.type, uri, urlOffset: Math.max(0, urlOffset) };
}
