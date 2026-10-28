import { MarkupKind, type MarkupContent } from 'vscode-languageserver';
import { SPEC_SITE, type KeySpec } from './grammar';

const VARIABLES_PAGE = `${SPEC_SITE}basics/Variables.html`;

export const VARIABLE_DOCS: Record<string, string> = {
  $resource: `\`$resource\`: root of the FHIR resource. [Variables](${VARIABLES_PAGE})`,
  $fhirRoot: `\`$fhirRoot\`: FHIR path of the parent mapping method. [Variables](${VARIABLES_PAGE})`,
  $archetype: `\`$archetype\`: root of the mapped archetype. [Variables](${VARIABLES_PAGE})`,
  $openehrRoot: `\`$openehrRoot\`: openEHR path of the parent mapping method. [Variables](${VARIABLES_PAGE})`,
  $composition: `\`$composition\`: root of the composition that contains the archetype, e.g. for the composer. [Variables](${VARIABLES_PAGE})`,
  $reference: `\`$reference\`: there is no direct openEHR path; the method continues in a referenced resource. [Variables](${VARIABLES_PAGE})`,
};

export function keyDocumentation(spec: KeySpec): MarkupContent {
  return markdown(spec.doc + (spec.specPage ? `\n\n[Specification](${SPEC_SITE}${spec.specPage})` : ''));
}

export function markdown(value: string): MarkupContent {
  return { kind: MarkupKind.Markdown, value };
}
