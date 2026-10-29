/*
 * A small XML reader for operational templates: elements, attributes and text, with the offset of
 * each element so that Go to Definition can open the template at a node. Comments, processing
 * instructions, CDATA and DOCTYPE are skipped; namespaces are kept as part of the names.
 */

export interface XmlElement {
  name: string;
  attributes: Record<string, string>;
  children: XmlElement[];
  text: string;
  /** offset of the `<` that opens the element */
  offset: number;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === '#') return String.fromCodePoint(name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10));
    return ENTITIES[name] ?? whole;
  });
}

const ATTRIBUTE = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g;

/** Parses `text` and returns its root element; throws on input that is not well-formed enough to read. */
export function parseXml(text: string): XmlElement {
  const root: XmlElement = { name: '#document', attributes: {}, children: [], text: '', offset: 0 };
  const stack: XmlElement[] = [root];
  let i = 0;
  while (i < text.length) {
    const lt = text.indexOf('<', i);
    const top = stack[stack.length - 1];
    if (lt < 0) break;
    if (lt > i) top.text += text.slice(i, lt);
    if (text.startsWith('<!--', lt)) {
      i = skipPast(text, lt, '-->');
    } else if (text.startsWith('<![CDATA[', lt)) {
      const end = text.indexOf(']]>', lt);
      if (end < 0) throw new Error('unterminated CDATA');
      top.text += text.slice(lt + 9, end);
      i = end + 3;
    } else if (text.startsWith('<?', lt)) {
      i = skipPast(text, lt, '?>');
    } else if (text.startsWith('<!', lt)) {
      i = skipPast(text, lt, '>');
    } else if (text[lt + 1] === '/') {
      const gt = text.indexOf('>', lt);
      if (gt < 0) throw new Error('unterminated end tag');
      const name = text.slice(lt + 2, gt).trim();
      if (stack.length < 2 || top.name !== name) throw new Error(`unexpected </${name}> at ${lt}`);
      top.text = decodeEntities(top.text);
      stack.pop();
      i = gt + 1;
    } else {
      const gt = tagEnd(text, lt);
      const selfClosing = text[gt - 1] === '/';
      const body = text.slice(lt + 1, selfClosing ? gt - 1 : gt);
      const nameEnd = body.search(/[\s/]|$/);
      const element: XmlElement = { name: body.slice(0, nameEnd), attributes: {}, children: [], text: '', offset: lt };
      ATTRIBUTE.lastIndex = nameEnd;
      for (let m = ATTRIBUTE.exec(body); m; m = ATTRIBUTE.exec(body)) element.attributes[m[1]] = decodeEntities(m[3] ?? m[4]);
      top.children.push(element);
      if (!selfClosing) stack.push(element);
      i = gt + 1;
    }
  }
  if (stack.length > 1) throw new Error(`unclosed <${stack[stack.length - 1].name}>`);
  const element = root.children[0];
  if (!element) throw new Error('no root element');
  return element;
}

function skipPast(text: string, from: number, marker: string): number {
  const end = text.indexOf(marker, from);
  if (end < 0) throw new Error(`unterminated ${marker}`);
  return end + marker.length;
}

/** The `>` that closes the tag opened at `lt`, ignoring `>` inside attribute values. */
function tagEnd(text: string, lt: number): number {
  let quote = '';
  for (let i = lt + 1; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '>') {
      return i;
    }
  }
  throw new Error('unterminated tag');
}

/** The first child named `name` (ignoring any namespace prefix). */
export function child(element: XmlElement | undefined, name: string): XmlElement | undefined {
  return element?.children.find((c) => localName(c.name) === name);
}

export function children(element: XmlElement | undefined, name: string): XmlElement[] {
  return element ? element.children.filter((c) => localName(c.name) === name) : [];
}

export function childText(element: XmlElement | undefined, name: string): string | undefined {
  const found = child(element, name);
  return found ? found.text.trim() : undefined;
}

function localName(name: string): string {
  const colon = name.indexOf(':');
  return colon < 0 ? name : name.slice(colon + 1);
}

/** `xsi:type` of an element, without its prefix. */
export function xsiType(element: XmlElement): string | undefined {
  for (const [key, value] of Object.entries(element.attributes)) {
    if (localName(key) === 'type') return localName(value);
  }
  return undefined;
}
