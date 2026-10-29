import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { isFhirConnect } from './document';

const SKIPPED_DIRECTORIES = new Set(['node_modules', '.git', 'dist', 'out', 'target', 'build', '.gradle', '.idea', '.vscode']);
const MAX_FILES = 20000;
/** StructureDefinitions larger than this are skipped */
const MAX_JSON_BYTES = 10 * 1024 * 1024;

export interface FoundFile {
  path: string;
  text: string;
}

/** True for files that may be operational templates or StructureDefinitions. */
export function isModelFile(path: string): boolean {
  return /\.(opt|json)$/i.test(path);
}

/** Below `root`: the FHIRConnect mapping files, and the operational templates and StructureDefinitions. */
export async function findWorkspaceFiles(root: string): Promise<{ mappings: FoundFile[]; models: FoundFile[] }> {
  const mappings: FoundFile[] = [];
  const models: FoundFile[] = [];
  let visited = 0;
  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (++visited > MAX_FILES) return;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) await walk(path);
      } else if (entry.isFile() && /\.ya?ml$/i.test(entry.name)) {
        try {
          const text = await readFile(path, 'utf8');
          if (isFhirConnect(text)) mappings.push({ path, text });
        } catch {
          // unreadable files are skipped
        }
      } else if (entry.isFile() && isModelFile(entry.name)) {
        try {
          if (/\.json$/i.test(entry.name) && (await stat(path)).size > MAX_JSON_BYTES) continue;
          const text = await readFile(path, 'utf8');
          if (/\.opt$/i.test(entry.name) || text.includes('"StructureDefinition"')) models.push({ path, text });
        } catch {
          // unreadable files are skipped
        }
      }
    }
  };
  await walk(root);
  return { mappings, models };
}
