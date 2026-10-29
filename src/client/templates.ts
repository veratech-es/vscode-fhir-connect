export type MappingKind = 'model' | 'extension' | 'context';

/** Grammar versions a new file can be written in, newest first. */
export const GRAMMAR_VERSIONS = ['1.0.0', '0.9.0'] as const;
export type GrammarVersion = (typeof GRAMMAR_VERSIONS)[number];

/** Snippet text for a new mapping file, following the layout of the FHIRConnect mapping library. */
export function mappingTemplate(kind: MappingKind, name: string, version: GrammarVersion = '1.0.0'): string {
  const header = [
    `grammar: FHIRConnect/v${version}`,
    `type: ${kind}`,
    'metadata:',
    `  name: ${escape(name)}`,
    '  version: ${1:0.0.1}',
    'spec:',
    '  system: FHIR',
    '  version: R4',
  ];
  switch (kind) {
    case 'model':
      return [
        ...header,
        '  openEhrConfig:',
        `    archetype: \${2:openEHR-EHR-${escape(name)}}`,
        '    revision: ${3:1.0.0}',
        '  fhirConfig:',
        '    structureDefinition: ${4:http://hl7.org/fhir/StructureDefinition/}',
        '',
        'mappings:',
        '  - name: ${5:name}',
        '    with:',
        '      fhir: \\$resource.$6',
        '      openehr: \\$archetype/$0',
        '',
      ].join('\n');
    case 'extension':
      return [
        ...header,
        '  extends: ${2:model mapping name}',
        '',
        'mappings:',
        '  - name: ${3:name}',
        '    extension: ${4|add,append,overwrite|}',
        '    with:',
        '      fhir: \\$resource.$5',
        '      openehr: \\$archetype/$0',
        '',
      ].join('\n');
    case 'context':
      return [
        ...header,
        '',
        'context:',
        '  profile:',
        '    url: $2',
        '    version: $3',
        '  template:',
        '    id: $4',
        '    sem_ver: $5',
        '  archetypes:',
        '    - $6',
        '  extensions:',
        '    - $7',
        '  start: $0',
        '',
      ].join('\n');
  }
}

/** Escapes snippet syntax in user input. */
function escape(text: string): string {
  return text.replace(/[$}\\]/g, (c) => '\\' + c);
}
