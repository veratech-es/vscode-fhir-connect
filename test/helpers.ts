import { parseFcDocument, type FcDocument } from '../src/server/document';

export const MODEL_HEADER = `grammar: FHIRConnect/v0.9.0
type: model
metadata:
  name: EVALUATION.problem_diagnosis.v1
  version: 0.0.1
spec:
  system: FHIR
  version: R4
  openEhrConfig:
    archetype: openEHR-EHR-EVALUATION.problem_diagnosis.v1
  fhirConfig:
    structureDefinition: http://hl7.org/fhir/StructureDefinition/Condition
`;

export const EXTENSION_HEADER = `grammar: FHIRConnect/v0.9.0
type: extension
metadata:
  name: KDS_problem_diagnose
  version: 0.0.1
spec:
  system: FHIR
  version: R4
  extends: EVALUATION.problem_diagnosis.v1
`;

/** Parses `text`, where `|` marks the cursor, and returns the document and the cursor position. */
export function withCursor(text: string): { doc: FcDocument; position: { line: number; character: number } } {
  const offset = text.indexOf('|');
  if (offset < 0) throw new Error('no cursor marker');
  const clean = text.slice(0, offset) + text.slice(offset + 1);
  const before = clean.slice(0, offset).split('\n');
  const doc = parseFcDocument(clean);
  if (!doc) throw new Error('not a FHIRConnect document');
  return { doc, position: { line: before.length - 1, character: before[before.length - 1].length } };
}

export function parse(text: string): FcDocument {
  const doc = parseFcDocument(text);
  if (!doc) throw new Error('not a FHIRConnect document');
  return doc;
}
