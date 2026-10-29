/*
 * The openEHR Reference Model (release 1.0.4) attributes that mapping paths step through after the
 * nodes a template constrains, e.g. `context/start_time` or `value/defining_code/code_string`.
 */

interface RmClass {
  base?: string;
  /** attribute name → type; a trailing `*` marks a list */
  attributes: Record<string, string>;
}

const RM: Record<string, RmClass> = {
  PATHABLE: { attributes: {} },
  LOCATABLE: {
    base: 'PATHABLE',
    attributes: { name: 'DV_TEXT', archetype_node_id: 'String', uid: 'UID_BASED_ID', links: 'LINK*', archetype_details: 'ARCHETYPED', feeder_audit: 'FEEDER_AUDIT' },
  },
  COMPOSITION: {
    base: 'LOCATABLE',
    attributes: { language: 'CODE_PHRASE', territory: 'CODE_PHRASE', category: 'DV_CODED_TEXT', composer: 'PARTY_PROXY', context: 'EVENT_CONTEXT', content: 'CONTENT_ITEM*' },
  },
  EVENT_CONTEXT: {
    base: 'PATHABLE',
    attributes: {
      start_time: 'DV_DATE_TIME',
      end_time: 'DV_DATE_TIME',
      location: 'String',
      setting: 'DV_CODED_TEXT',
      other_context: 'ITEM_STRUCTURE',
      health_care_facility: 'PARTY_IDENTIFIED',
      participations: 'PARTICIPATION*',
    },
  },
  CONTENT_ITEM: { base: 'LOCATABLE', attributes: {} },
  SECTION: { base: 'CONTENT_ITEM', attributes: { items: 'CONTENT_ITEM*' } },
  ENTRY: {
    base: 'CONTENT_ITEM',
    attributes: {
      language: 'CODE_PHRASE',
      encoding: 'CODE_PHRASE',
      subject: 'PARTY_PROXY',
      provider: 'PARTY_PROXY',
      other_participations: 'PARTICIPATION*',
      workflow_id: 'OBJECT_REF',
    },
  },
  ADMIN_ENTRY: { base: 'ENTRY', attributes: { data: 'ITEM_STRUCTURE' } },
  GENERIC_ENTRY: { base: 'CONTENT_ITEM', attributes: { data: 'ITEM_TREE' } },
  CARE_ENTRY: { base: 'ENTRY', attributes: { protocol: 'ITEM_STRUCTURE', guideline_id: 'OBJECT_REF' } },
  OBSERVATION: { base: 'CARE_ENTRY', attributes: { data: 'HISTORY', state: 'HISTORY' } },
  EVALUATION: { base: 'CARE_ENTRY', attributes: { data: 'ITEM_STRUCTURE' } },
  INSTRUCTION: { base: 'CARE_ENTRY', attributes: { narrative: 'DV_TEXT', expiry_time: 'DV_DATE_TIME', wf_definition: 'DV_PARSABLE', activities: 'ACTIVITY*' } },
  ACTIVITY: { base: 'LOCATABLE', attributes: { description: 'ITEM_STRUCTURE', timing: 'DV_PARSABLE', action_archetype_id: 'String' } },
  ACTION: {
    base: 'CARE_ENTRY',
    attributes: { time: 'DV_DATE_TIME', description: 'ITEM_STRUCTURE', ism_transition: 'ISM_TRANSITION', instruction_details: 'INSTRUCTION_DETAILS' },
  },
  ISM_TRANSITION: { base: 'PATHABLE', attributes: { current_state: 'DV_CODED_TEXT', transition: 'DV_CODED_TEXT', careflow_step: 'DV_CODED_TEXT', reason: 'DV_TEXT*' } },
  INSTRUCTION_DETAILS: { base: 'PATHABLE', attributes: { instruction_id: 'LOCATABLE_REF', activity_id: 'String', wf_details: 'ITEM_STRUCTURE' } },

  DATA_STRUCTURE: { base: 'LOCATABLE', attributes: {} },
  ITEM_STRUCTURE: { base: 'DATA_STRUCTURE', attributes: {} },
  ITEM_TREE: { base: 'ITEM_STRUCTURE', attributes: { items: 'ITEM*' } },
  ITEM_LIST: { base: 'ITEM_STRUCTURE', attributes: { items: 'ELEMENT*' } },
  ITEM_SINGLE: { base: 'ITEM_STRUCTURE', attributes: { item: 'ELEMENT' } },
  ITEM_TABLE: { base: 'ITEM_STRUCTURE', attributes: { rows: 'CLUSTER*' } },
  HISTORY: { base: 'DATA_STRUCTURE', attributes: { origin: 'DV_DATE_TIME', period: 'DV_DURATION', duration: 'DV_DURATION', summary: 'ITEM_STRUCTURE', events: 'EVENT*' } },
  EVENT: { base: 'LOCATABLE', attributes: { time: 'DV_DATE_TIME', data: 'ITEM_STRUCTURE', state: 'ITEM_STRUCTURE' } },
  POINT_EVENT: { base: 'EVENT', attributes: {} },
  INTERVAL_EVENT: { base: 'EVENT', attributes: { width: 'DV_DURATION', sample_count: 'Integer', math_function: 'DV_CODED_TEXT' } },
  ITEM: { base: 'LOCATABLE', attributes: {} },
  CLUSTER: { base: 'ITEM', attributes: { items: 'ITEM*' } },
  ELEMENT: { base: 'ITEM', attributes: { value: 'DATA_VALUE', null_flavour: 'DV_CODED_TEXT', null_reason: 'DV_TEXT' } },

  DATA_VALUE: { attributes: {} },
  DV_BOOLEAN: { base: 'DATA_VALUE', attributes: { value: 'Boolean' } },
  DV_STATE: { base: 'DATA_VALUE', attributes: { value: 'DV_CODED_TEXT', is_terminal: 'Boolean' } },
  DV_IDENTIFIER: { base: 'DATA_VALUE', attributes: { issuer: 'String', assigner: 'String', id: 'String', type: 'String' } },
  DV_TEXT: {
    base: 'DATA_VALUE',
    attributes: { value: 'String', hyperlink: 'DV_URI', formatting: 'String', mappings: 'TERM_MAPPING*', language: 'CODE_PHRASE', encoding: 'CODE_PHRASE' },
  },
  DV_CODED_TEXT: { base: 'DV_TEXT', attributes: { defining_code: 'CODE_PHRASE' } },
  DV_PARAGRAPH: { base: 'DATA_VALUE', attributes: { items: 'DV_TEXT*' } },
  TERM_MAPPING: { attributes: { match: 'String', purpose: 'DV_CODED_TEXT', target: 'CODE_PHRASE' } },
  CODE_PHRASE: { attributes: { terminology_id: 'TERMINOLOGY_ID', code_string: 'String', preferred_term: 'String' } },
  DV_ORDERED: { base: 'DATA_VALUE', attributes: { normal_status: 'CODE_PHRASE', normal_range: 'DV_INTERVAL', other_reference_ranges: 'REFERENCE_RANGE*' } },
  DV_INTERVAL: {
    base: 'DATA_VALUE',
    attributes: { lower: 'DV_ORDERED', upper: 'DV_ORDERED', lower_included: 'Boolean', upper_included: 'Boolean', lower_unbounded: 'Boolean', upper_unbounded: 'Boolean' },
  },
  REFERENCE_RANGE: { attributes: { meaning: 'DV_TEXT', range: 'DV_INTERVAL' } },
  DV_ORDINAL: { base: 'DV_ORDERED', attributes: { value: 'Integer', symbol: 'DV_CODED_TEXT' } },
  DV_SCALE: { base: 'DV_ORDERED', attributes: { value: 'Real', symbol: 'DV_CODED_TEXT' } },
  DV_QUANTIFIED: { base: 'DV_ORDERED', attributes: { magnitude_status: 'String', accuracy: 'Real' } },
  DV_AMOUNT: { base: 'DV_QUANTIFIED', attributes: { accuracy_is_percent: 'Boolean' } },
  DV_QUANTITY: {
    base: 'DV_AMOUNT',
    attributes: { magnitude: 'Real', units: 'String', precision: 'Integer', units_system: 'String', units_display_name: 'String', property: 'CODE_PHRASE' },
  },
  DV_COUNT: { base: 'DV_AMOUNT', attributes: { magnitude: 'Integer' } },
  DV_PROPORTION: { base: 'DV_AMOUNT', attributes: { numerator: 'Real', denominator: 'Real', type: 'Integer', precision: 'Integer' } },
  DV_DURATION: { base: 'DV_AMOUNT', attributes: { value: 'String' } },
  DV_TEMPORAL: { base: 'DV_QUANTIFIED', attributes: { accuracy: 'DV_DURATION' } },
  DV_DATE: { base: 'DV_TEMPORAL', attributes: { value: 'String' } },
  DV_TIME: { base: 'DV_TEMPORAL', attributes: { value: 'String' } },
  DV_DATE_TIME: { base: 'DV_TEMPORAL', attributes: { value: 'String' } },
  DV_ENCAPSULATED: { base: 'DATA_VALUE', attributes: { charset: 'CODE_PHRASE', language: 'CODE_PHRASE' } },
  DV_MULTIMEDIA: {
    base: 'DV_ENCAPSULATED',
    attributes: {
      alternate_text: 'String',
      uri: 'DV_URI',
      data: 'String',
      media_type: 'CODE_PHRASE',
      compression_algorithm: 'CODE_PHRASE',
      integrity_check: 'String',
      integrity_check_algorithm: 'CODE_PHRASE',
      size: 'Integer',
      thumbnail: 'DV_MULTIMEDIA',
    },
  },
  DV_PARSABLE: { base: 'DV_ENCAPSULATED', attributes: { value: 'String', formalism: 'String' } },
  DV_URI: { base: 'DATA_VALUE', attributes: { value: 'String' } },
  DV_EHR_URI: { base: 'DV_URI', attributes: {} },

  PARTY_PROXY: { attributes: { external_ref: 'PARTY_REF' } },
  PARTY_SELF: { base: 'PARTY_PROXY', attributes: {} },
  PARTY_IDENTIFIED: { base: 'PARTY_PROXY', attributes: { name: 'String', identifiers: 'DV_IDENTIFIER*' } },
  PARTY_RELATED: { base: 'PARTY_IDENTIFIED', attributes: { relationship: 'DV_CODED_TEXT' } },
  PARTICIPATION: { attributes: { function: 'DV_TEXT', mode: 'DV_CODED_TEXT', performer: 'PARTY_PROXY', time: 'DV_INTERVAL' } },
  OBJECT_REF: { attributes: { id: 'OBJECT_ID', namespace: 'String', type: 'String' } },
  PARTY_REF: { base: 'OBJECT_REF', attributes: {} },
  LOCATABLE_REF: { base: 'OBJECT_REF', attributes: { path: 'String' } },
  OBJECT_ID: { attributes: { value: 'String' } },
  UID_BASED_ID: { base: 'OBJECT_ID', attributes: {} },
  TERMINOLOGY_ID: { base: 'OBJECT_ID', attributes: {} },
  ARCHETYPE_ID: { base: 'OBJECT_ID', attributes: {} },
  TEMPLATE_ID: { base: 'OBJECT_ID', attributes: {} },
  ARCHETYPED: { attributes: { archetype_id: 'ARCHETYPE_ID', template_id: 'TEMPLATE_ID', rm_version: 'String' } },
  LINK: { attributes: { meaning: 'DV_TEXT', type: 'DV_TEXT', target: 'DV_EHR_URI' } },
  FEEDER_AUDIT: {
    attributes: {
      originating_system_item_ids: 'DV_IDENTIFIER*',
      feeder_system_item_ids: 'DV_IDENTIFIER*',
      original_content: 'DV_ENCAPSULATED',
      originating_system_audit: 'FEEDER_AUDIT_DETAILS',
      feeder_system_audit: 'FEEDER_AUDIT_DETAILS',
    },
  },
  FEEDER_AUDIT_DETAILS: {
    attributes: { system_id: 'String', location: 'PARTY_IDENTIFIED', provider: 'PARTY_IDENTIFIED', subject: 'PARTY_PROXY', time: 'DV_DATE_TIME', version_id: 'String' },
  },
};

/** Abstract classes, which stand for any of their descendants. */
const subclasses = new Map<string, string[]>();
for (const [name, cls] of Object.entries(RM)) {
  for (let base = cls.base; base; base = RM[base]?.base) {
    const list = subclasses.get(base) ?? [];
    list.push(name);
    subclasses.set(base, list);
  }
}

export interface RmAttribute {
  name: string;
  type: string;
  multiple: boolean;
  /** class that declares it */
  declaredIn: string;
}

export function isRmClass(type: string): boolean {
  return type in RM;
}

/** Attributes of `type`, inherited ones included. */
export function rmAttributes(type: string): RmAttribute[] {
  const result: RmAttribute[] = [];
  for (let name: string | undefined = type; name && RM[name]; name = RM[name].base) {
    for (const [attribute, spec] of Object.entries(RM[name].attributes)) {
      if (result.some((a) => a.name === attribute)) continue;
      result.push({ name: attribute, type: spec.replace('*', ''), multiple: spec.endsWith('*'), declaredIn: name });
    }
  }
  return result;
}

/** The attribute `name` of `type`, or of any of its descendants when `type` is abstract. */
export function rmAttribute(type: string, name: string): RmAttribute | undefined {
  const own = rmAttributes(type).find((a) => a.name === name);
  if (own) return own;
  for (const sub of subclasses.get(type) ?? []) {
    const found = rmAttributes(sub).find((a) => a.name === name);
    if (found) return found;
  }
  return undefined;
}

/** True when `type` is `ancestor` or one of its descendants. */
export function rmConforms(type: string, ancestor: string): boolean {
  for (let name: string | undefined = type; name; name = RM[name]?.base) if (name === ancestor) return true;
  return false;
}
