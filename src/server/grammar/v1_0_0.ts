import type { BlockSpec, Grammar } from './types';
import { blocks as v090, UNIDIRECTIONAL } from './v0_9_0';

/*
 * FHIRConnect grammar v1.0.0, the version documented by the specification
 * (https://github.com/SevKohler/FHIRconnect-spec, Apache-2.0) and used by the main branch of the
 * mapping library. No engine runs it yet.
 *
 * It is v0.9.0 with these changes:
 * - `fhirConfig.multiple` and `fhirConfig.condition` are gone; conditions on the whole model go to
 *   `preprocessor`.
 * - `spec.unidirectional` sets the direction of a whole model, e.g. of an operational mapping.
 * - Methods can `link` to another composition and enter a sub-context with `slotContext`.
 * - Context files gain `scope`, `contexts` (sub-contexts) and `operational` (operational models).
 * - Paths go up with `^` (FHIR) and `../` (openEHR).
 */

const blocks: Record<string, BlockSpec> = structuredClone(v090);

blocks.root.keys.grammar = {
  ...blocks.root.keys.grammar,
  value: { kind: 'scalar', values: ['FHIRConnect/v1.0.0'] },
  doc: 'Grammar and version this file is written in, e.g. `FHIRConnect/v1.0.0`.',
};

blocks.spec.keys.unidirectional = {
  value: { kind: 'scalar', values: UNIDIRECTIONAL, strict: true, caseInsensitive: true },
  fileTypes: ['model', 'extension'],
  doc: 'Runs the whole mapping in one direction only: `openEHR->fhir` or `fhir->openehr`. Operational mappings set it once here.',
  specPage: 'types-of-mapping-files/operational-mappings.html',
};
blocks.spec.keys.openEhrConfig = {
  ...blocks.spec.keys.openEhrConfig,
  doc: 'Which openEHR archetype a model mapping maps. Operational mappings (e.g. Provenance) have none.',
};

delete blocks.fhirConfig.keys.multiple;
delete blocks.fhirConfig.keys.condition;

blocks.method.keys.slotContext = {
  value: { kind: 'scalar' },
  fileTypes: ['model', 'extension'],
  doc: 'Name of a context mapping entered at this path, instead of a model mapping as with `slotArchetype`. The engine maps from that context\'s `start` with its own archetypes and extensions. Not together with `slotArchetype`, and not with `openehr: $reference`.',
  specPage: 'types-of-mapping-files/sub-contexts.html',
};
blocks.method.keys.link = {
  value: { kind: 'map', block: 'link' },
  doc: 'Linked mapping: the referenced FHIR resource is mapped with its own context into a separate composition, linked from the openEHR `links` path of this method.',
  specPage: 'types-of-mappings/concept-type/concept-mappings.html#LinkedMappings',
  snippet: 'link:\n  meaning: $1\n  type: $2',
};
blocks.link = {
  label: 'link',
  keys: {
    meaning: {
      value: { kind: 'scalar' },
      doc: 'Meaning of the openEHR LINK, e.g. `the diagnosis of the reason`.',
      specPage: 'types-of-mappings/concept-type/concept-mappings.html#LinkedMappings',
    },
    type: {
      value: { kind: 'scalar' },
      doc: 'Type of the openEHR LINK, e.g. `partOf` or `diagnosis`.',
      specPage: 'types-of-mappings/concept-type/concept-mappings.html#LinkedMappings',
    },
  },
};

blocks.with.keys.fhir = {
  ...blocks.with.keys.fhir,
  doc: 'FHIR path (FHIRPath). `$resource` is the root resource, `$fhirRoot` the path of the parent method; inside `followedBy` paths are relative to the parent. Each `^` goes up one element of the parent path, e.g. `^^.use`.',
};
blocks.with.keys.openehr = {
  ...blocks.with.keys.openehr,
  doc: 'openEHR path. `$archetype` is the root archetype, `$composition` the composition, `$openehrRoot` the path of the parent method, `$reference` marks that there is no direct path. Each `../` goes up one element of the parent path.',
};
blocks.pathValue.keys.value = {
  ...blocks.pathValue.keys.value,
  doc: 'Fixed value written to the path. In operational mappings, `$context.<name>` takes the value from the REST call. Quote values YAML would read as numbers or booleans.',
};

blocks.context.keys.scope = {
  value: { kind: 'scalar', values: ['root', 'sub'], strict: true },
  doc: '`sub` marks a sub-context: only entered through `slotContext`, it maps into the parent composition and never splits bundles. Defaults to `root`.',
  specPage: 'types-of-mapping-files/sub-contexts.html',
};
blocks.context.keys.contexts = {
  value: { kind: 'list', item: { kind: 'scalar' } },
  doc: 'Names of the sub-contexts this context enters through `slotContext`.',
  specPage: 'types-of-mapping-files/sub-contexts.html',
};
blocks.context.keys.operational = {
  value: { kind: 'list', item: { kind: 'scalar' } },
  doc: 'Names of operational model mappings (e.g. `provenance`) this context triggers; the engine produces them as a side effect of the run.',
  specPage: 'types-of-mapping-files/operational-mappings.html',
};

export const grammarV100: Grammar = {
  version: '1.0.0',
  root: 'root',
  blocks,
  pathOperators: true,
};
