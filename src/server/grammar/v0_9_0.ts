import type { BlockSpec, Grammar, KeySpec, ScalarSpec } from './types';

/*
 * FHIRConnect grammar v0.9.0, the version executed by the openFHIR engine.
 *
 * Derived from the openFHIR engine model classes and JSON schemas
 * (https://github.com/medblocks/openFHIR, Apache-2.0) and checked against the 0.9.0 tag of
 * the mapping library (https://github.com/SevKohler/FHIRconnect-mapping-lib/tree/0.9.0).
 * Descriptions follow the published specification, which documents v1.0.0; differences
 * to v1.0.0 are called out in the text.
 */

const string: ScalarSpec = { kind: 'scalar' };
const boolean: ScalarSpec = { kind: 'scalar', type: 'boolean', values: ['true', 'false'], strict: true };

export const OPERATORS = ['one of', 'not of', 'empty', 'not empty', 'type'] as const;
export const UNIDIRECTIONAL = ['openEHR->fhir', 'fhir->openehr'] as const;
export const DATA_TYPES = [
  'NONE',
  'BOOL',
  'CODEABLECONCEPT',
  'CODING',
  'DATE',
  'DATETIME',
  'DOSAGE',
  'ID',
  'IDENTIFIER',
  'PERIOD',
  'PROPORTION',
  'QUANTITY',
  'STRING',
  'TEXT',
] as const;
export const FHIR_VARIABLES = ['$resource', '$fhirRoot', '$reference'] as const;
export const OPENEHR_VARIABLES = ['$archetype', '$openehrRoot', '$composition', '$reference'] as const;

const conditionKeys: Record<string, KeySpec> = {
  targetRoot: {
    value: string,
    required: true,
    doc: 'Path of the element the condition returns once filtered. It must line up with the path of the surrounding `with`.',
    specPage: 'basics/Conditions.html',
  },
  targetAttribute: {
    value: string,
    doc: 'Path, relative to `targetRoot`, of the attribute that is checked against `criteria`.',
    specPage: 'basics/Conditions.html',
  },
  targetAttributes: {
    value: { kind: 'list', item: string },
    doc: 'Several attributes relative to `targetRoot`; the condition holds when any of them matches (OR).',
    specPage: 'basics/Conditions.html',
  },
  operator: {
    value: { kind: 'scalar', values: OPERATORS, strict: true },
    required: true,
    doc: 'How the attribute is compared: `one of`, `not of`, `empty`, `not empty` or `type`.',
    specPage: 'basics/Conditions.html',
  },
  criteria: {
    value: { kind: 'scalarOrList', scalar: string },
    doc: 'Value the attribute is compared with. Not needed for `empty` and `not empty`. Quote values YAML would read as numbers or booleans, e.g. `"524"`.',
    specPage: 'basics/Conditions.html',
  },
  criterias: {
    value: { kind: 'list', item: string },
    doc: 'Several values the attribute is compared with.',
    specPage: 'basics/Conditions.html',
  },
  identifying: {
    value: boolean,
    doc: 'Marks the condition as identifying the element, so the engine uses it to tell list entries apart.',
    specPage: 'basics/Conditions.html',
  },
};

const conditionSnippet = (key: string) =>
  `${key}:\n  targetRoot: $1\n  targetAttribute: $2\n  operator: \${3|${OPERATORS.join(',')}|}\n  criteria: $0`;

export const blocks: Record<string, BlockSpec> = {
  root: {
    label: 'file header',
    keys: {
      grammar: {
        value: { kind: 'scalar', values: ['FHIRConnect/v0.9.0'] },
        required: true,
        doc: 'Grammar and version this file is written in, e.g. `FHIRConnect/v0.9.0`.',
        specPage: 'basics/main.html',
      },
      type: {
        value: { kind: 'scalar', values: ['model', 'extension', 'context'], strict: true },
        required: true,
        doc: 'Kind of mapping file: `model` maps an archetype to a FHIR resource, `extension` changes a model mapping, `context` combines mappings for a template and profile.',
        specPage: 'types-of-mapping-files/main.html',
      },
      metadata: {
        value: { kind: 'map', block: 'metadata' },
        required: true,
        doc: 'Name and version of this mapping. The name identifies the mapping and is how other files reference it.',
        specPage: 'basics/main.html',
        snippet: 'metadata:\n  name: $1\n  version: ${2:0.0.1}',
      },
      spec: {
        value: { kind: 'map', block: 'spec' },
        required: true,
        doc: 'What standard is mapped (`system: FHIR`, `version: R4`) and, for models and extensions, which archetype and StructureDefinition.',
        specPage: 'basics/main.html',
      },
      preprocessor: {
        value: { kind: 'map', block: 'preprocessor' },
        fileTypes: ['model', 'extension'],
        doc: 'Logic executed before the mapping body: conditions and hierarchy mappings only.',
        specPage: 'basics/preprocessor.html',
      },
      mappings: {
        value: { kind: 'list', item: { kind: 'map', block: 'method' } },
        fileTypes: ['model', 'extension'],
        doc: 'Body of the file: the list of mapping methods, each starting with `- name:`.',
        specPage: 'basics/body.html',
      },
      context: {
        value: { kind: 'map', block: 'context' },
        fileTypes: ['context'],
        requiredIn: ['context'],
        doc: 'Which template and profile this context maps, which model and extension mappings it loads and where the engine starts.',
        specPage: 'types-of-mapping-files/context-mappings.html',
      },
    },
  },
  metadata: {
    label: 'metadata',
    keys: {
      name: {
        value: string,
        required: true,
        doc: 'Unique name of the mapping, used by `slotArchetype`, `extends` and context files to reference it. Model mappings are named after the archetype, e.g. `EVALUATION.problem_diagnosis.v1`.',
        specPage: 'basics/main.html',
      },
      version: {
        value: string,
        required: true,
        doc: 'Version of this mapping. Several versions of a mapping can coexist.',
        specPage: 'basics/main.html',
      },
    },
  },
  spec: {
    label: 'spec',
    keys: {
      system: {
        value: { kind: 'scalar', values: ['FHIR'], strict: true },
        required: true,
        doc: 'Standard that is mapped against openEHR. Only `FHIR` is defined.',
        specPage: 'basics/main.html',
      },
      version: {
        value: { kind: 'scalar', values: ['R4'], strict: true },
        required: true,
        doc: 'FHIR release the mapping was written for. Only `R4` is defined.',
        specPage: 'basics/main.html',
      },
      openEhrConfig: {
        value: { kind: 'map', block: 'openEhrConfig' },
        fileTypes: ['model', 'extension'],
        doc: 'Which openEHR archetype a model mapping maps.',
        specPage: 'basics/main.html',
        snippet: 'openEhrConfig:\n  archetype: ${1:openEHR-EHR-}\n  revision: $2',
      },
      fhirConfig: {
        value: { kind: 'map', block: 'fhirConfig' },
        fileTypes: ['model', 'extension'],
        doc: 'Which FHIR StructureDefinition a model mapping maps to.',
        specPage: 'basics/main.html',
        snippet: 'fhirConfig:\n  structureDefinition: ${1:http://hl7.org/fhir/StructureDefinition/}',
      },
      extends: {
        value: string,
        fileTypes: ['extension'],
        requiredIn: ['extension'],
        doc: 'Name (`metadata.name`) of the model mapping this extension changes.',
        specPage: 'types-of-mapping-files/extension-mappings.html',
      },
    },
  },
  openEhrConfig: {
    label: 'openEhrConfig',
    keys: {
      archetype: {
        value: string,
        required: true,
        doc: 'Full id of the mapped archetype, e.g. `openEHR-EHR-EVALUATION.problem_diagnosis.v1`.',
        specPage: 'basics/main.html',
      },
      revision: {
        value: string,
        doc: 'Revision of the archetype this mapping applies to.',
        specPage: 'basics/main.html',
      },
    },
  },
  fhirConfig: {
    label: 'fhirConfig',
    keys: {
      structureDefinition: {
        value: string,
        required: true,
        doc: 'Canonical URL of the FHIR StructureDefinition that is mapped. Informational, it does not change the mapping.',
        specPage: 'basics/main.html',
      },
      multiple: {
        value: boolean,
        doc: 'v0.9.0: whether openEHR -> FHIR returns several resources instead of a single one.',
      },
      condition: {
        value: { kind: 'list', item: { kind: 'map', block: 'condition' } },
        doc: 'v0.9.0: conditions a FHIR resource must meet to be mapped, e.g. to skip `entered-in-error` entries. v1.0.0 moves this to `preprocessor`.',
        specPage: 'basics/preprocessor.html',
      },
    },
  },
  preprocessor: {
    label: 'preprocessor',
    keys: {
      fhirCondition: {
        value: { kind: 'map', block: 'condition' },
        doc: 'Condition on the FHIR side evaluated before the body is processed.',
        specPage: 'basics/preprocessor.html',
        snippet: conditionSnippet('fhirCondition'),
      },
      fhirConditions: {
        value: { kind: 'list', item: { kind: 'map', block: 'condition' } },
        doc: 'Several FHIR-side conditions evaluated before the body is processed.',
        specPage: 'basics/preprocessor.html',
      },
      openehrCondition: {
        value: { kind: 'map', block: 'condition' },
        doc: 'Condition on the openEHR side evaluated before the body is processed.',
        specPage: 'basics/preprocessor.html',
        snippet: conditionSnippet('openehrCondition'),
      },
      hierarchy: {
        value: { kind: 'map', block: 'hierarchy' },
        doc: 'Hierarchy mapping: splits one structure into several resources or entries.',
        specPage: 'types-of-mappings/concept-type/HierarchyMappings.html',
      },
    },
  },
  hierarchy: {
    label: 'hierarchy',
    keys: {
      with: {
        value: { kind: 'map', block: 'pathPair' },
        doc: 'FHIR and openEHR paths of the hierarchy.',
        specPage: 'types-of-mappings/concept-type/HierarchyMappings.html',
      },
      split: {
        value: { kind: 'map', block: 'split' },
        doc: 'How the hierarchy is split on the FHIR and openEHR side.',
        specPage: 'types-of-mappings/concept-type/HierarchyMappings.html',
      },
    },
  },
  pathPair: {
    label: 'with',
    keys: {
      fhir: { value: string, doc: 'FHIR path (FHIRPath).', specPage: 'basics/body.html' },
      openehr: { value: string, doc: 'openEHR path.', specPage: 'basics/body.html' },
    },
  },
  split: {
    label: 'split',
    keys: {
      fhir: { value: { kind: 'map', block: 'splitSide' }, doc: 'How the FHIR side is split.' },
      openehr: { value: { kind: 'map', block: 'splitSide' }, doc: 'How the openEHR side is split.' },
    },
  },
  splitSide: {
    label: 'split side',
    keys: {
      create: { value: string, doc: 'What is created for each split element.' },
      path: { value: string, doc: 'Path that is split.' },
      unique: { value: { kind: 'list', item: string }, doc: 'Paths that identify a split element.' },
    },
  },
  method: {
    label: 'mapping method',
    itemSnippet: {
      label: 'mapping method',
      detail: 'name, with: fhir / openehr',
      body: 'name: ${1:name}\n  with:\n    fhir: ${2:\\$resource}\n    openehr: ${3:\\$archetype}',
    },
    keys: {
      name: {
        value: string,
        required: true,
        doc: 'Name of the mapping method, in camelCase. Extensions use it to `overwrite` a method or to `appendTo` it.',
        specPage: 'basics/body.html',
      },
      extension: {
        value: { kind: 'scalar', values: ['add', 'append', 'overwrite'], strict: true },
        fileTypes: ['extension'],
        doc: 'What this method does to the extended model: `add` a method at the end, `append` a `followedBy` to the method named in `appendTo`, or `overwrite` the method with the same name.',
        specPage: 'types-of-mapping-files/extension-methods.html',
      },
      appendTo: {
        value: string,
        fileTypes: ['extension'],
        doc: 'Name of the model method an `append` extension adds to; `parent.child` for a nested method.',
        specPage: 'types-of-mapping-files/extension-methods.html',
      },
      with: {
        value: { kind: 'map', block: 'with' },
        doc: 'The FHIR and openEHR paths this method maps against each other.',
        specPage: 'basics/body.html',
        snippet: 'with:\n  fhir: ${1:\\$resource}\n  openehr: ${2:\\$archetype}',
      },
      slotArchetype: {
        value: string,
        doc: 'Name of a model mapping applied at this path, typically for an archetype slotted into this one, e.g. `CLUSTER.specimen.v1`.',
        specPage: 'types-of-mappings/concept-type/SlotArchetypes.html',
      },
      mappingCode: {
        value: string,
        doc: 'Name of a programmed mapping the engine runs instead of the generic path mapping, for structures that differ too much between openEHR and FHIR.',
        specPage: 'types-of-mappings/concept-type/concept-mappings.html',
      },
      unidirectional: {
        value: { kind: 'scalar', values: UNIDIRECTIONAL, strict: true, caseInsensitive: true },
        doc: 'Runs this method, and its children, in one direction only: `openEHR->fhir` or `fhir->openehr`.',
        specPage: 'basics/body.html',
      },
      manual: {
        value: { kind: 'list', item: { kind: 'map', block: 'manualEntry' } },
        doc: 'Manual mappings: fixed values written to FHIR or openEHR paths, usually guarded by conditions.',
        specPage: 'types-of-mappings/concept-type/manual.html',
      },
      fhirCondition: {
        value: { kind: 'map', block: 'condition' },
        doc: 'The method only runs when this FHIR-side condition holds.',
        specPage: 'basics/Conditions.html',
        snippet: conditionSnippet('fhirCondition'),
      },
      openehrCondition: {
        value: { kind: 'map', block: 'condition' },
        doc: 'The method only runs when this openEHR-side condition holds.',
        specPage: 'basics/Conditions.html',
        snippet: conditionSnippet('openehrCondition'),
      },
      followedBy: {
        value: { kind: 'map', block: 'followedBy' },
        doc: 'Child methods. Their paths are relative to the paths of this method.',
        specPage: 'basics/FollowedBy.html',
        snippet: 'followedBy:\n  mappings:\n    - name: ${1:name}\n      with:\n        fhir: $2\n        openehr: $3',
      },
      reference: {
        value: { kind: 'map', block: 'reference' },
        doc: 'Maps into another FHIR resource referenced from this path; its methods start at the referenced resource.',
        specPage: 'types-of-mappings/concept-type/Reference.html',
        snippet: 'reference:\n  resourceType: $1\n  mappings:\n    - name: ${2:name}\n      with:\n        fhir: ${3:\\$fhirRoot}\n        openehr: $4',
      },
    },
  },
  with: {
    label: 'with',
    keys: {
      fhir: {
        value: { kind: 'scalar', values: FHIR_VARIABLES },
        doc: 'FHIR path (FHIRPath). `$resource` is the root resource, `$fhirRoot` the path of the parent method; inside `followedBy` paths are relative to the parent.',
        specPage: 'basics/Variables.html',
      },
      openehr: {
        value: { kind: 'scalar', values: OPENEHR_VARIABLES },
        doc: 'openEHR path. `$archetype` is the root archetype, `$composition` the composition, `$openehrRoot` the path of the parent method, `$reference` marks that there is no direct path.',
        specPage: 'basics/Variables.html',
      },
      type: {
        value: { kind: 'scalar', values: DATA_TYPES },
        doc: 'Data type the paths are mapped as, e.g. `CODEABLECONCEPT`, `DATETIME` or `NONE` (paths are only followed, nothing is mapped). Usually resolved by the engine.',
        specPage: 'types-of-mappings/data-type/data-mappings.html',
      },
      value: {
        value: string,
        doc: 'Fixed value used instead of reading one of the paths.',
        specPage: 'basics/body.html',
      },
    },
  },
  condition: {
    label: 'condition',
    itemSnippet: {
      label: 'condition',
      detail: 'targetRoot, targetAttribute, operator, criteria',
      body: `targetRoot: $1\n  targetAttribute: $2\n  operator: \${3|${OPERATORS.join(',')}|}\n  criteria: $0`,
    },
    keys: conditionKeys,
  },
  followedBy: {
    label: 'followedBy',
    keys: {
      mappings: {
        value: { kind: 'list', item: { kind: 'map', block: 'method' } },
        required: true,
        doc: 'Child methods, with paths relative to the parent method.',
        specPage: 'basics/FollowedBy.html',
      },
    },
  },
  reference: {
    label: 'reference',
    keys: {
      resourceType: {
        value: string,
        required: true,
        doc: 'FHIR resource type that is referenced, e.g. `Specimen`.',
        specPage: 'types-of-mappings/concept-type/Reference.html',
      },
      mappings: {
        value: { kind: 'list', item: { kind: 'map', block: 'method' } },
        required: true,
        doc: 'Methods applied to the referenced resource; `$fhirRoot` points at it.',
        specPage: 'types-of-mappings/concept-type/Reference.html',
      },
    },
  },
  manualEntry: {
    label: 'manual mapping',
    itemSnippet: {
      label: 'manual mapping',
      detail: 'name, fhir: path / value',
      body: 'name: ${1:name}\n  fhir:\n    - path: $2\n      value: $3',
    },
    keys: {
      name: {
        value: string,
        doc: 'Name of the manual mapping.',
        specPage: 'types-of-mappings/concept-type/manual.html',
      },
      fhir: {
        value: { kind: 'list', item: { kind: 'map', block: 'pathValue' } },
        doc: 'FHIR paths and the fixed values written to them.',
        specPage: 'types-of-mappings/concept-type/manual.html',
        snippet: 'fhir:\n  - path: $1\n    value: $2',
      },
      openehr: {
        value: { kind: 'list', item: { kind: 'map', block: 'pathValue' } },
        doc: 'openEHR paths and the fixed values written to them.',
        specPage: 'types-of-mappings/concept-type/manual.html',
        snippet: 'openehr:\n  - path: $1\n    value: $2',
      },
      fhirCondition: {
        value: { kind: 'map', block: 'condition' },
        doc: 'The manual mapping applies when this FHIR-side condition holds (FHIR -> openEHR).',
        specPage: 'types-of-mappings/concept-type/manual.html',
        snippet: conditionSnippet('fhirCondition'),
      },
      openehrCondition: {
        value: { kind: 'map', block: 'condition' },
        doc: 'The manual mapping applies when this openEHR-side condition holds (openEHR -> FHIR).',
        specPage: 'types-of-mappings/concept-type/manual.html',
        snippet: conditionSnippet('openehrCondition'),
      },
      unidirectional: {
        value: { kind: 'scalar', values: UNIDIRECTIONAL, strict: true, caseInsensitive: true },
        doc: 'Runs this manual mapping in one direction only.',
        specPage: 'basics/body.html',
      },
      value: {
        value: string,
        doc: 'Fixed value of the manual mapping.',
        specPage: 'types-of-mappings/concept-type/manual.html',
      },
    },
  },
  pathValue: {
    label: 'path / value',
    itemSnippet: { label: 'path / value', detail: 'path, value', body: 'path: $1\n  value: $2' },
    keys: {
      path: {
        value: string,
        doc: 'Path, relative to the method path, that receives the value.',
        specPage: 'types-of-mappings/concept-type/manual.html',
      },
      value: {
        value: string,
        doc: 'Fixed value written to the path. Quote values YAML would read as numbers or booleans.',
        specPage: 'types-of-mappings/concept-type/manual.html',
      },
    },
  },
  context: {
    label: 'context',
    keys: {
      profile: {
        value: { kind: 'map', block: 'profile' },
        doc: 'FHIR profile mapped by this context, as given in `meta.profile` of an instance.',
        specPage: 'types-of-mapping-files/context-mappings.html',
        snippet: 'profile:\n  url: $1\n  version: $2',
      },
      template: {
        value: { kind: 'map', block: 'template' },
        doc: 'openEHR template mapped by this context.',
        specPage: 'types-of-mapping-files/context-mappings.html',
        snippet: 'template:\n  id: $1\n  sem_ver: $2',
      },
      archetypes: {
        value: { kind: 'list', item: string },
        doc: 'Names of the model mappings used for this template and profile.',
        specPage: 'types-of-mapping-files/context-mappings.html',
      },
      extensions: {
        value: { kind: 'list', item: string },
        doc: 'Names of the extension mappings applied to the models whenever they are used in this context.',
        specPage: 'types-of-mapping-files/context-mappings.html',
      },
      start: {
        value: string,
        doc: 'Name of the model mapping where the engine starts.',
        specPage: 'types-of-mapping-files/context-mappings.html',
      },
    },
  },
  profile: {
    label: 'profile',
    keys: {
      url: { value: string, doc: 'Canonical URL of the FHIR profile.', specPage: 'types-of-mapping-files/context-mappings.html' },
      version: { value: string, doc: 'Version of the profile this context is for.', specPage: 'types-of-mapping-files/context-mappings.html' },
    },
  },
  template: {
    label: 'template',
    keys: {
      id: { value: string, doc: 'Exact id of the openEHR template.', specPage: 'types-of-mapping-files/context-mappings.html' },
      sem_ver: { value: string, doc: 'Version of the template that is mapped.', specPage: 'types-of-mapping-files/context-mappings.html' },
    },
  },
};

export const grammarV090: Grammar = {
  version: '0.9.0',
  root: 'root',
  blocks,
  engine: 'openFHIR',
  pathOperators: false,
};
