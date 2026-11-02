import type { BlockSpec, FileType, Grammar, KeySpec, ValueSpec } from './types';
import { grammarV090 } from './v0_9_0';
import { grammarV100 } from './v1_0_0';

export * from './types';

const GRAMMARS: readonly Grammar[] = [grammarV090, grammarV100];

/** grammar used for completion and hover in files whose version is not supported */
export const DEFAULT_GRAMMAR = grammarV100;

export const SUPPORTED_VERSIONS = GRAMMARS.map((g) => g.version);

/** The grammar for a version such as "0.9.0", or undefined when the version is not supported. */
export function grammarFor(version: string | undefined): Grammar | undefined {
  return GRAMMARS.find((g) => g.version === version);
}

/** Keys of a block that are allowed in a file of the given type (all keys when the type is unknown). */
export function keysFor(block: BlockSpec, fileType: FileType | undefined): [string, KeySpec][] {
  return Object.entries(block.keys).filter(([, spec]) => !fileType || !spec.fileTypes || spec.fileTypes.includes(fileType));
}

export function isRequired(spec: KeySpec, fileType: FileType | undefined): boolean {
  return !!spec.required || (!!fileType && !!spec.requiredIn?.includes(fileType));
}

/** The value spec reached by following `path` (keys and '-' for list items) from the root. */
export function resolvePath(grammar: Grammar, path: readonly string[]): ValueSpec | undefined {
  let current: ValueSpec = { kind: 'map', block: grammar.root };
  for (const segment of path) {
    if (segment === '-') {
      if (current.kind === 'list') current = current.item;
      else if (current.kind === 'scalarOrList') current = current.scalar;
      else return undefined;
      continue;
    }
    if (current.kind !== 'map') return undefined;
    const spec: KeySpec | undefined = grammar.blocks[current.block]?.keys[segment];
    if (!spec) return undefined;
    current = spec.value;
  }
  return current;
}
