import { parseAdl, type Archetype } from './adl';
import { CORE_PREFIX, coreType, parseProfile, type Profile } from './fhir';
import { parseOpt, type OptNode, type Template } from './opt';

/** The operational templates and StructureDefinitions of the workspace. */
export class ModelIndex {
  private readonly templates = new Map<string, Template>();
  private readonly profiles = new Map<string, Profile>();
  private readonly adl = new Map<string, Archetype>();
  private readonly lines = new Map<string, number[]>();
  private sorted: Template[] | undefined;
  /** bumped on every change, so that resolutions built on older models can be dropped */
  generation = 0;

  /** Indexes a `.opt`, `.adl` or `.json` file; other content is dropped. Returns true when the file is a model. */
  set(uri: string, text: string): boolean {
    this.delete(uri);
    if (/\.opt$/i.test(uri)) {
      const template = parseOpt(uri, text);
      if (template) this.templates.set(uri, template);
      this.sorted = undefined;
      if (template) this.lines.set(uri, lineStarts(text));
      return !!template;
    }
    if (/\.adl$/i.test(uri)) {
      const archetype = parseAdl(uri, text);
      if (archetype?.definition) archetype.definition.slotFillers = (slot) => this.slotFillers(slot);
      if (archetype) this.adl.set(uri, archetype);
      if (archetype) this.lines.set(uri, lineStarts(text));
      return !!archetype;
    }
    if (/\.json$/i.test(uri)) {
      const profile = parseProfile(uri, text);
      if (profile) this.profiles.set(uri, profile);
      if (profile) this.lines.set(uri, lineStarts(text));
      return !!profile;
    }
    return false;
  }

  delete(uri: string): void {
    this.templates.delete(uri);
    this.profiles.delete(uri);
    this.adl.delete(uri);
    this.lines.delete(uri);
    this.sorted = undefined;
    this.generation++;
  }

  /** Line and character of an offset in a template or StructureDefinition file. */
  positionAt(uri: string, offset: number): { line: number; character: number } {
    const starts = this.lines.get(uri) ?? [0];
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (starts[mid] <= offset) low = mid;
      else high = mid - 1;
    }
    return { line: low, character: offset - starts[low] };
  }

  get hasTemplates(): boolean {
    return this.templates.size > 0;
  }

  /** True when the workspace has ADL archetypes or operational templates. */
  get hasOpenEhrModels(): boolean {
    return this.templates.size > 0 || this.adl.size > 0;
  }

  allTemplates(): Template[] {
    return (this.sorted ??= [...this.templates.values()].sort((a, b) => a.uri.localeCompare(b.uri)));
  }

  templateById(id: string): Template[] {
    return this.allTemplates().filter((t) => t.id === id);
  }

  /** Every archetype root, in any template, of the archetype `id`. */
  archetypeRoots(id: string): OptNode[] {
    return this.allTemplates().flatMap((t) => t.archetypes.get(id) ?? []);
  }

  /** The roots of the ADL archetypes of the workspace with this id that could be read, by file name order. */
  adlRoots(id: string): OptNode[] {
    return this.archetypeFiles(id).flatMap((a) => (a.definition ? [a.definition.root] : []));
  }

  /** The roots of the ADL archetypes a slot accepts, one per archetype id. */
  slotFillers(slot: OptNode): OptNode[] {
    if (slot.kind !== 'slot') return [];
    const patterns = (slot.includes ?? []).flatMap((p) => {
      try {
        return [new RegExp(`^(?:${p})$`)];
      } catch {
        return [];
      }
    });
    const roots = new Map<string, OptNode>();
    for (const archetype of [...this.adl.values()].sort((a, b) => a.uri.localeCompare(b.uri))) {
      if (!archetype.definition || roots.has(archetype.id) || archetype.definition.root.rmType !== slot.rmType) continue;
      if (patterns.some((p) => p.test(archetype.id))) roots.set(archetype.id, archetype.definition.root);
    }
    return [...roots.values()];
  }

  /** The ADL archetypes of the workspace with this id, by file name order. */
  archetypeFiles(id: string): Archetype[] {
    return [...this.adl.values()].filter((a) => a.id === id).sort((a, b) => a.uri.localeCompare(b.uri));
  }

  profileByUrl(url: string): Profile | undefined {
    const bare = url.split('|')[0];
    return [...this.profiles.values()].find((p) => p.url === bare);
  }

  /** The FHIR type a `structureDefinition` URL stands for: a core type, or the type a workspace profile constrains. */
  typeForUrl(url: string): { type: string; profile?: Profile } | undefined {
    const bare = url.split('|')[0].trim();
    if (bare.startsWith(CORE_PREFIX)) {
      const name = bare.slice(CORE_PREFIX.length);
      if (coreType(name)) return { type: name };
    }
    const profile = this.profileByUrl(bare);
    if (profile && coreType(profile.type)) return { type: profile.type, profile };
    return undefined;
  }
}

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}
