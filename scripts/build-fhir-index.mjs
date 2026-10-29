// Builds src/server/models/fhir-r4.json, the compact index of the FHIR R4 (4.0.1) resources and data
// types that path resolution uses, from the official definition bundles `profiles-resources.json` and
// `profiles-types.json` (CC0, http://hl7.org/fhir/R4/downloads.html).
//
// The @medplum/definitions npm package ships copies of both bundles:
//
//   npm pack @medplum/definitions@3.2.0 && tar xzf medplum-definitions-3.2.0.tgz
//   node scripts/build-fhir-index.mjs package/dist/fhir/r4

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: node scripts/build-fhir-index.mjs <folder with profiles-resources.json and profiles-types.json>');
  process.exit(1);
}

const definitions = ['profiles-types.json', 'profiles-resources.json'].flatMap((file) =>
  JSON.parse(readFileSync(join(dir, file), 'utf8'))
    .entry.map((e) => e.resource)
    .filter((r) => r.resourceType === 'StructureDefinition' && r.derivation !== 'constraint'),
);

const SYSTEM_TYPES = {
  'http://hl7.org/fhirpath/System.String': 'string',
  'http://hl7.org/fhirpath/System.Boolean': 'boolean',
  'http://hl7.org/fhirpath/System.Integer': 'integer',
  'http://hl7.org/fhirpath/System.Decimal': 'decimal',
  'http://hl7.org/fhirpath/System.Date': 'date',
  'http://hl7.org/fhirpath/System.DateTime': 'dateTime',
  'http://hl7.org/fhirpath/System.Time': 'time',
};
const KIND = { resource: 'resource', 'complex-type': 'complex', 'primitive-type': 'primitive' };
const types = {};

for (const sd of definitions) {
  const root = sd.type;
  const elements = sd.snapshot.element;
  const entry = (path, kind, base, short) => (types[path] ??= { kind, ...(base && { base }), ...(short && { short }), elements: {} });
  entry(root, KIND[sd.kind] ?? 'complex', sd.baseDefinition?.split('/').pop(), elements[0]?.short);
  if (sd.abstract) types[root].abstract = true;

  for (const el of elements.slice(1)) {
    if (el.sliceName || el.max === '0') continue;
    const dot = el.path.lastIndexOf('.');
    const parent = el.path.slice(0, dot);
    let name = el.path.slice(dot + 1);
    const choice = name.endsWith('[x]');
    if (choice) name = name.slice(0, -3);
    const owner = types[parent] ?? entry(parent, 'backbone', undefined, undefined);
    const element = { min: el.min, max: el.max };
    if (choice) element.choice = true;
    if (el.contentReference) {
      element.types = [el.contentReference.slice(1)];
    } else {
      // the `value` of a primitive is its FHIRPath System value, not a path step in mappings
      if (types[parent]?.kind === 'primitive' && name === 'value') continue;
      const codes = (el.type ?? []).map((t) => SYSTEM_TYPES[t.code] ?? t.code);
      element.types = codes.includes('BackboneElement') || codes.includes('Element') ? [el.path] : codes;
      const targets = (el.type ?? []).flatMap((t) => (t.code === 'Reference' ? t.targetProfile ?? [] : [])).map((p) => p.split('/').pop());
      if (targets.length && !targets.includes('Resource')) element.targets = targets;
    }
    if (el.short) element.short = el.short;
    owner.elements[name] = element;
    if (element.types[0] === el.path) entry(el.path, 'backbone', 'BackboneElement', el.short);
  }
}

// snapshots repeat the inherited elements (`id`, `extension`, `meta`, ...); keep them only on the base type
const inherited = (type) => {
  const base = types[type.base];
  return base ? { ...inherited(base), ...base.elements } : {};
};
for (const type of Object.values(types)) {
  const fromBase = inherited(type);
  for (const name of Object.keys(type.elements)) if (fromBase[name]) delete type.elements[name];
}

const out = { fhirVersion: '4.0.1', types };
const file = new URL('../src/server/models/fhir-r4.json', import.meta.url);
writeFileSync(file, JSON.stringify(out));
console.log(`${Object.keys(types).length} types written to ${file.pathname}`);
