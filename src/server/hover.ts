import { type Hover, type Position } from 'vscode-languageserver';
import { resolvePath } from './grammar';
import { ancestry, lineInfo } from './cursor';
import type { FcDocument } from './document';
import { keyDocumentation, VARIABLE_DOCS } from './docs';

export function hover(doc: FcDocument, position: Position): Hover | null {
  const lines = doc.text.split(/\r?\n/);
  const line = lines[position.line] ?? '';
  const info = lineInfo(line);
  if (!info?.key) return null;
  const ch = position.character;

  if (ch >= info.keyCol && ch <= info.keyCol + info.key.length) {
    const { path } = ancestry(lines, position.line, info.keyCol, info.dashCol);
    const container = resolvePath(doc.grammar, path);
    if (container?.kind !== 'map') return null;
    const spec = doc.grammar.blocks[container.block].keys[info.key];
    if (!spec) return null;
    return {
      contents: keyDocumentation(spec),
      range: { start: { line: position.line, character: info.keyCol }, end: { line: position.line, character: info.keyCol + info.key.length } },
    };
  }

  if (info.valueCol !== undefined && info.value && ch >= info.valueCol) {
    const variable = /\$[A-Za-z]+/g;
    for (let m = variable.exec(info.value); m; m = variable.exec(info.value)) {
      const start = info.valueCol + m.index;
      if (ch >= start && ch <= start + m[0].length && VARIABLE_DOCS[m[0]]) {
        return {
          contents: { kind: 'markdown', value: VARIABLE_DOCS[m[0]] },
          range: { start: { line: position.line, character: start }, end: { line: position.line, character: start + m[0].length } },
        };
      }
    }
  }
  return null;
}
