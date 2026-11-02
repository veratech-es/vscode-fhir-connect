# FHIRConnect for VS Code: cheat sheet

Version 0.4.0 (phases 1 to 4). The [user guide](user-guide.md) explains each feature in detail.

The extension acts on `.yml` / `.yaml` files with a top-level `grammar: FHIRConnect/v0.9.0` or
`grammar: FHIRConnect/v1.0.0` line; each file is checked with the version it declares.
Path features (phase 3) also need the operational templates (`.opt`) somewhere in the workspace;
FHIR R4 is bundled.

## Keyboard shortcuts

| Action | Windows / Linux | macOS | Works on |
| --- | --- | --- | --- |
| Open completion | `Ctrl+Space` | `Ctrl+Space` | keys, values, `$` variables, mapping names, path segments |
| Show or hide completion details | `Ctrl+Space` (list open) | `Ctrl+Space` (list open) | completion list |
| Next / previous snippet placeholder | `Tab` / `Shift+Tab` | `Tab` / `Shift+Tab` | inserted snippets |
| Show hover | `Ctrl+K Ctrl+I` | `Cmd+K Cmd+I` | keys, variables, references, path segments |
| Go to Definition | `F12` or `Ctrl+click` | `F12` or `Cmd+click` | references, `appendTo`, openEHR path segments, `template.id`, profile URLs |
| Peek Definition | `Alt+F12` | `Option+F12` | same as Go to Definition |
| Go to Archetype Definition (ADL) | `Ctrl+Alt+F12` | `Cmd+Option+F12` | openEHR path segments, `openEhrConfig.archetype` |
| Peek Archetype Definition (ADL) | `Ctrl+Shift+Alt+F12` | `Cmd+Shift+Option+F12` | same |
| Show inlay hints while held (*offUnlessPressed*) | `Ctrl+Alt` | `Ctrl+Option` | path hints |
| Go back | `Alt+Left` | `Ctrl+-` | after a jump |
| Find All References (peek) | `Shift+F12` | `Shift+F12` | `metadata.name`, references |
| Find All References (panel) | `Shift+Alt+F12` | `Shift+Option+F12` | `metadata.name`, references |
| Rename Symbol | `F2` | `F2` | `metadata.name`, references |
| Preview a rename | `Shift+Enter` in the rename box | `Shift+Enter` in the rename box | rename |
| Go to method in file | `Ctrl+Shift+O` | `Cmd+Shift+O` | outline |
| Focus breadcrumbs | `Ctrl+Shift+.` | `Cmd+Shift+.` | outline |
| Problems panel | `Ctrl+Shift+M` | `Cmd+Shift+M` | validation |
| Next / previous problem | `F8` / `Shift+F8` | `F8` / `Shift+F8` | validation |
| Show Mapping Context | `Ctrl+Alt+M` | `Cmd+Option+M` | mapping files |
| Command palette | `Ctrl+Shift+P` | `Cmd+Shift+P` | *FHIRConnect: New Mapping File* |
| Save all (after a rename) | `Ctrl+K S` | `Cmd+Option+S` | rename |

## Features at a glance

| Feature | How | Phase |
| --- | --- | --- |
| Validation | Automatic while typing; squiggles and *Problems* panel | 1 |
| Key completion | Type a key or `Ctrl+Space`; required keys first | 1 |
| Structure snippets | Pick `with`, `fhirCondition`, `followedBy`, `reference`, ... | 1 |
| New method | `- ` on a new line in `mappings:` | 1 |
| Value completion | After `key: ` for fixed values, after `$` for variables | 1 |
| Hover docs | Mouse over a key or `$variable` | 1 |
| Outline | *Outline* view, breadcrumbs, `Ctrl+Shift+O` | 1 |
| New file | *FHIRConnect: New Mapping File* | 1 |
| Jump to mapping file | `F12` on a reference | 2 |
| Who uses this mapping | `Shift+F12` on `metadata.name` | 2 |
| Rename a mapping everywhere | `F2` on `metadata.name` or a reference | 2 |
| Name completion | After `slotArchetype:`, `extends:`, `start:`, `appendTo:`, `- ` in `archetypes` / `extensions` | 2 |
| Reference hover | Mouse over a reference: target file with link | 2 |
| Unresolved names | Automatic warning on names no file declares | 2 |
| Path hover | Mouse over a path segment: node label, RM type, cardinality, template / FHIR type | 3 |
| Inlay hints | Grey hint after each `with.fhir` / `with.openehr` line | 3 |
| Path completion | `Ctrl+Space` inside a path: child nodes `attr[code]`, RM attributes, FHIR elements, `as(T)`, types inside `as(` | 3 |
| Jump into the template | `F12` on an openEHR path segment or `context.template.id` | 3 |
| Jump into the archetype | `Ctrl+Alt+F12` on an openEHR path segment (needs the `.adl` in the workspace) | 3 |
| Path warnings | Automatic warning on the first segment that does not resolve | 3 |
| Grammar v1.0.0 | Automatic, from the `grammar` line; v0.9.0 files keep working | 4 |
| Path operators | `^.code` (FHIR) and `../items[at0001]` (openEHR) go back one element of the parent path (v1.0.0) | 4 |
| Mapping context | *FHIRConnect Mapping Context* view in the Explorer, `Ctrl+Alt+M` | 4 |

## Reference sites

| Key | Points at |
| --- | --- |
| `slotArchetype` | model |
| `slotContext` (v1.0.0) | context |
| `spec.extends` | model |
| `context.archetypes` items | model |
| `context.extensions` items | extension |
| `context.contexts` items (v1.0.0) | context |
| `context.operational` items (v1.0.0) | model |
| `context.start` | model |
| `appendTo` | method of the `spec.extends` model (`parent.child` when nested) |

A name matches `metadata.name` or, for models, the archetype id; exact first, then ignoring case. If
several files match, the one in the nearest folder wins.

## Allowed values

| Key | Values |
| --- | --- |
| `type` | `model`, `extension`, `context` |
| `spec.system` / `spec.version` | `FHIR` / `R4` |
| `extension` | `add`, `append`, `overwrite` |
| `context.scope` (v1.0.0) | `root`, `sub` |
| `unidirectional` | `openEHR->fhir`, `fhir->openehr` |
| `operator` | `one of`, `not of`, `empty`, `not empty`, `type` |
| FHIR variables | `$resource`, `$fhirRoot`, `$reference` |
| openEHR variables | `$archetype`, `$openehrRoot`, `$composition`, `$reference` |

Quote values YAML would read as numbers or booleans: `criteria: "524"`.

## Path roots

| Path | Starts from |
| --- | --- |
| `$resource.x` | root resource (`structureDefinition`) |
| `$fhirRoot.x`, `x` | parent method's FHIR path (`parent.x`) |
| `$archetype/x` | archetype root |
| `$composition/x` | template's root COMPOSITION |
| `$openehrRoot/x`, `x` | parent method's openEHR path (`parent/x`) |
| `$reference` | parent's openEHR context; FHIR side continues in the referenced resource |
| `^.x`, `^^.x` (v1.0.0) | one element back up the parent's FHIR path per `^` |
| `../x` (v1.0.0) | one step back up the parent's openEHR path per `../` |
| `…\|code` | the part after `\|` is not checked |

In a slot model, `$resource` / `$archetype` are the calling method's paths. ELEMENT→`value` and
DV_CODED_TEXT→`defining_code` may be left out, as in the engine.

## Settings

| Setting | Default |
| --- | --- |
| `fhirconnect.validation.enable` | `true` |
| `fhirconnect.validation.paths` | `true` |
| `fhirconnect.inlayHints.enable` | `true` |
| `fhirconnect.trace.server` | `off` |

## v0.9.0 or v1.0.0

| Only in v0.9.0 | Only in v1.0.0 |
| --- | --- |
| `fhirConfig.multiple`, `fhirConfig.condition` | `spec.unidirectional`, `link`, `slotContext`, `context.scope`, `context.contexts`, `context.operational`, `^`, `../`, `$context` |
