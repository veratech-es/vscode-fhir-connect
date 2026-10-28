import { Document, parseDocument } from 'yaml';
import { DEFAULT_GRAMMAR, FILE_TYPES, grammarFor, type FileType, type Grammar } from './grammar';

/** `grammar: FHIRConnect/v0.9.0` as a top-level key, quoted or not. */
const GRAMMAR_LINE = /^grammar:[ \t]*(["']?)FHIRConnect\/v?([^\s"'#]*)\1/m;
const TYPE_LINE = /^type:[ \t]*(["']?)([A-Za-z]+)\1[ \t]*(?:#.*)?$/m;

export interface FcDocument {
  text: string;
  yaml: Document.Parsed;
  /** version from the grammar line, e.g. "0.9.0" */
  version: string;
  /** grammar for `version`, undefined when that version is not supported */
  supportedGrammar: Grammar | undefined;
  /** grammar used for completion and hover: the supported one, or the default */
  grammar: Grammar;
  fileType: FileType | undefined;
}

/** True when the text is a FHIRConnect mapping file, i.e. it has a top-level `grammar: FHIRConnect/...`. */
export function isFhirConnect(text: string): boolean {
  return GRAMMAR_LINE.test(text);
}

export function parseFcDocument(text: string): FcDocument | undefined {
  const grammarMatch = GRAMMAR_LINE.exec(text);
  if (!grammarMatch) return undefined;
  const version = grammarMatch[2];
  const supportedGrammar = grammarFor(version);
  const typeMatch = TYPE_LINE.exec(text);
  const type = typeMatch?.[2];
  return {
    text,
    yaml: parseDocument(text, { prettyErrors: false, uniqueKeys: true }),
    version,
    supportedGrammar,
    grammar: supportedGrammar ?? DEFAULT_GRAMMAR,
    fileType: FILE_TYPES.includes(type as FileType) ? (type as FileType) : undefined,
  };
}
