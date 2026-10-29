import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isFhirConnect } from './document';

const SKIPPED_DIRECTORIES = new Set(['node_modules', '.git', 'dist', 'out', 'target', 'build', '.gradle', '.idea', '.vscode']);
const MAX_FILES = 20000;

/** All FHIRConnect mapping files below `root`, with their text. */
export async function findMappingFiles(root: string): Promise<{ path: string; text: string }[]> {
  const found: { path: string; text: string }[] = [];
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
          if (isFhirConnect(text)) found.push({ path, text });
        } catch {
          // unreadable files are skipped
        }
      }
    }
  };
  await walk(root);
  return found;
}
