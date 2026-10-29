/*
 * Works out where the cursor is in the YAML structure from indentation alone, so completion
 * and hover also work while the file is half written and does not parse.
 */

/** A key, or '-' for a list item. */
export type Segment = string;

export interface LineInfo {
  /** column of the `- ` that starts a list item on this line */
  dashCol?: number;
  /** column where the key (or the item's scalar) starts */
  keyCol: number;
  key?: string;
  /** column after `key:` and the following whitespace */
  valueCol?: number;
  value?: string;
}

const LINE = /^(\s*)(-(?:\s+|$))?(.*)$/;
const KEY = /^(["']?)([A-Za-z_$][\w$.\-]*)\1\s*:(?=\s|$)(\s*)(.*)$/;

/** Splits a line into its list dash, key and value; undefined for blank, comment and document marker lines. */
export function lineInfo(line: string): LineInfo | undefined {
  const m = LINE.exec(line)!;
  const lead = m[1].length;
  const rest = m[3];
  if (!m[2] && (rest === '' || rest.startsWith('#') || rest.startsWith('---') || rest.startsWith('...'))) return undefined;
  const info: LineInfo = { keyCol: lead + (m[2]?.length ?? 0) };
  if (m[2]) info.dashCol = lead;
  const k = KEY.exec(rest);
  if (k) {
    info.key = k[2];
    info.valueCol = info.keyCol + rest.length - k[4].length;
    info.value = stripComment(k[4]);
  }
  return info;
}

function stripComment(value: string): string {
  const hash = value.search(/(^|\s)#/);
  return (hash < 0 ? value : value.slice(0, hash)).trimEnd();
}

export interface Ancestry {
  /** path from the root to the map the line sits in, e.g. ['mappings', '-', 'with'] */
  path: Segment[];
  /** keys at the same level of that map, without the key on the line itself */
  siblings: Set<string>;
}

/**
 * Finds the map a key at `col` on line `lineNo` belongs to.
 * @param dashCol set when the line itself starts a list item at that column
 */
export function ancestry(lines: string[], lineNo: number, col: number, dashCol?: number): Ancestry {
  const path: Segment[] = [];
  const siblings = new Set<string>();
  let mode: 'map' | 'item' = 'map';
  let level = col;
  let collecting = true; // still in the cursor's own map
  if (dashCol !== undefined) {
    path.unshift('-');
    level = dashCol;
    mode = 'item';
    collecting = false;
  }
  collectBelow(lines, lineNo, col, siblings);
  for (let i = lineNo - 1; i >= 0; i--) {
    const info = lineInfo(lines[i]);
    if (!info) continue;
    if (mode === 'map') {
      if (info.keyCol > level) continue;
      if (info.keyCol === level) {
        if (collecting && info.key) siblings.add(info.key);
        if (info.dashCol !== undefined) {
          // first key of the list item that holds this map
          path.unshift('-');
          level = info.dashCol;
          mode = 'item';
          collecting = false;
        }
        continue;
      }
    } else {
      const start = info.dashCol ?? info.keyCol;
      if (start > level || info.dashCol === level) continue; // deeper, or a sibling item
      if (info.keyCol > level) break;
    }
    if (!info.key || info.value) break; // a parent key has its value on the following lines
    collecting = false;
    path.unshift(info.key);
    level = info.keyCol;
    mode = 'map';
    if (info.dashCol !== undefined) {
      path.unshift('-');
      level = info.dashCol;
      mode = 'item';
    }
  }
  return { path, siblings };
}

/** Adds the keys at `col` below `lineNo` that belong to the same map. */
function collectBelow(lines: string[], lineNo: number, col: number, siblings: Set<string>): void {
  for (let i = lineNo + 1; i < lines.length; i++) {
    const info = lineInfo(lines[i]);
    if (!info) continue;
    const start = info.dashCol ?? info.keyCol;
    if (start < col) return;
    if (info.dashCol === undefined && info.keyCol === col && info.key) siblings.add(info.key);
  }
}

export type CursorContext =
  /** typing a key; `prefix` is what was typed so far, from column `start` */
  | { kind: 'key'; path: Segment[]; siblings: Set<string>; prefix: string; start: number; keyCol: number; lineIndent: number; newItem: boolean }
  /** typing the value of `key`, which starts at column `start` and currently reads `value` */
  | { kind: 'value'; path: Segment[]; key: string; start: number; end: number; value: string };

/** What is being typed at `character` on line `lineNo`. */
export function cursorContext(lines: string[], lineNo: number, character: number): CursorContext | undefined {
  const line = lines[lineNo] ?? '';
  const before = line.slice(0, character);
  const lineIndent = /^\s*/.exec(line)![0].length;

  const keyTyping = /^(\s*)(-\s+)?([\w$.\-]*)$/.exec(before);
  if (keyTyping) {
    const dashCol = keyTyping[2] ? keyTyping[1].length : undefined;
    const keyCol = keyTyping[1].length + (keyTyping[2]?.length ?? 0);
    const { path, siblings } = ancestry(lines, lineNo, keyCol, dashCol);
    return {
      kind: 'key',
      path,
      siblings,
      prefix: keyTyping[3],
      start: character - keyTyping[3].length,
      keyCol,
      lineIndent,
      newItem: dashCol !== undefined,
    };
  }

  const info = lineInfo(line);
  if (info?.key && info.valueCol !== undefined && character >= info.valueCol) {
    const { path } = ancestry(lines, lineNo, info.keyCol, info.dashCol);
    const end = info.valueCol + (info.value?.length ?? 0);
    return { kind: 'value', path, key: info.key, start: info.valueCol, end: Math.max(end, character), value: info.value ?? '' };
  }
  return undefined;
}
