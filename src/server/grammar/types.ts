/** The three kinds of FHIRConnect mapping files, as given by the top-level `type` key. */
export type FileType = 'model' | 'extension' | 'context';

export const FILE_TYPES: readonly FileType[] = ['model', 'extension', 'context'];

/** What a key's value must look like. */
export type ValueSpec =
  | ScalarSpec
  | { kind: 'map'; block: string }
  | { kind: 'list'; item: ValueSpec }
  /** a scalar, or a list of scalars (e.g. `criteria`) */
  | { kind: 'scalarOrList'; scalar: ScalarSpec };

export interface ScalarSpec {
  kind: 'scalar';
  /** values offered by completion */
  values?: readonly string[];
  /** when true, a value outside `values` is reported */
  strict?: boolean;
  /** compare against `values` ignoring case */
  caseInsensitive?: boolean;
  /** `boolean` only accepts true / false */
  type?: 'string' | 'boolean';
}

export interface KeySpec {
  value: ValueSpec;
  /** one or two sentences shown on hover */
  doc: string;
  /** page of the specification, relative to the spec site root */
  specPage?: string;
  required?: boolean;
  /** file types where the key is allowed; all when omitted */
  fileTypes?: readonly FileType[];
  /** file types where the key is required (in addition to `required`) */
  requiredIn?: readonly FileType[];
  /** LSP snippet inserted after `key:` when the key is completed; `${indent}` is not used, lines are relative */
  snippet?: string;
}

export interface BlockSpec {
  /** human readable name used in messages, e.g. "mapping method" */
  label: string;
  keys: Record<string, KeySpec>;
  /** snippet for a new list item of this block, inserted after `- ` */
  itemSnippet?: { label: string; body: string; detail: string };
}

export interface Grammar {
  /** grammar version, e.g. "0.9.0" */
  version: string;
  /** block of the document root */
  root: string;
  blocks: Record<string, BlockSpec>;
  /** engine that runs this version, named in messages about what it does */
  engine?: string;
  /** whether paths may go up with `^` (FHIR) and `../` (openEHR) */
  pathOperators: boolean;
}

export const SPEC_SITE = 'https://sevkohler.github.io/FHIRconnect-spec/FHIRconnect/v1.0.0/';
