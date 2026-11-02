# FHIRConnect for VS Code: cheat sheet

Version 0.5.1. The [user guide](user-guide.md) explains each feature in detail.

The extension acts on `.yml` / `.yaml` files with a top-level `grammar: FHIRConnect/v0.9.0` or
`grammar: FHIRConnect/v1.0.0` line; each file is checked with the version it declares.
Path features also need the operational templates (`.opt`) somewhere in the workspace;
FHIR R4 is bundled. Running mappings needs an openFHIR engine, e.g. in Docker.

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
| Command palette | `Ctrl+Shift+P` | `Cmd+Shift+P` | *FHIRConnect: New Mapping File*, *Peek Archetype Definition*, *Run Mapping to openEHR / to FHIR*, *Sync Mappings with openFHIR*, *Check openFHIR Connection*, *Set openFHIR Token* |
| Save all (after a rename) | `Ctrl+K S` | `Cmd+Option+S` | rename |

## Features at a glance

| Feature | How |
| --- | --- |
| Validation | Automatic while typing; squiggles and *Problems* panel |
| Key completion | Type a key or `Ctrl+Space`; required keys first |
| Structure snippets | Pick `with`, `fhirCondition`, `followedBy`, `reference`, ... |
| New method | `- ` on a new line in `mappings:` |
| Value completion | After `key: ` for fixed values, after `$` for variables |
| Hover docs | Mouse over a key or `$variable` |
| Outline | *Outline* view, breadcrumbs, `Ctrl+Shift+O` |
| New file | *FHIRConnect: New Mapping File* |
| Jump to mapping file | `F12` on a reference |
| Who uses this mapping | `Shift+F12` on `metadata.name` |
| Rename a mapping everywhere | `F2` on `metadata.name` or a reference |
| Name completion | After `slotArchetype:`, `extends:`, `start:`, `appendTo:`, `- ` in `archetypes` / `extensions` |
| Reference hover | Mouse over a reference: target file with link |
| Unresolved names | Automatic warning on names no file declares |
| Path hover | Mouse over a path segment: node label, RM type, cardinality, template / FHIR type |
| Inlay hints | Grey hint after each `with.fhir` / `with.openehr` line |
| Path completion | `Ctrl+Space` inside a path: child nodes `attr[code]`, RM attributes, FHIR elements, `as(T)`, types inside `as(` |
| Jump into the template | `F12` on an openEHR path segment or `context.template.id` |
| Jump into the archetype | `Ctrl+Alt+F12` on an openEHR path segment (needs the `.adl` in the workspace) |
| Path warnings | Automatic warning on the first segment that does not resolve |
| Grammar v1.0.0 | Automatic, from the `grammar` line; v0.9.0 files keep working |
| Path operators | `^.code` (FHIR) and `../items[at0001]` (openEHR) go back one element of the parent path (v1.0.0) |
| Mapping context | *FHIRConnect Mapping Context* view in the Explorer, `Ctrl+Alt+M` |
| Start openFHIR | `docker compose up -d` with [`docs/openfhir/docker-compose.yml`](openfhir/docker-compose.yml) and `MAPPINGS` = your mapping folder |
| Check the engine | Click *openFHIR* in the status bar, or *FHIRConnect: Check openFHIR Connection* |
| Reload mappings in the engine | Automatic on save, or *FHIRConnect: Sync Mappings with openFHIR*; load failures go to *Problems* |
| FHIR → openEHR | Open a FHIR resource or Bundle (`.json`), play button (or right-click the file in the Explorer) → *Run Mapping to openEHR*, pick the template |
| openEHR → FHIR | Open a canonical or flat Composition (`.json`), play button (or right-click the file in the Explorer) → *Run Mapping to FHIR*, pick the template |
| Engine issues | *Problems* (source *openFHIR*) and *Output* → *FHIRConnect openFHIR* |
| Engine on another computer | `fhirconnect.openfhir.url`; *FHIRConnect: Set openFHIR Token* for a bearer token (empty value removes it) |

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
| `fhirconnect.openfhir.url` | `http://localhost:8080` |
| `fhirconnect.openfhir.syncOnSave` | `true` |
| `fhirconnect.openfhir.bootstrapFolder` | empty (workspace folder) |
| `fhirconnect.openfhir.format` | `canonical` (or `flat`) |
| `fhirconnect.trace.server` | `off` |

## v0.9.0 or v1.0.0

| Only in v0.9.0 | Only in v1.0.0 |
| --- | --- |
| `fhirConfig.multiple`, `fhirConfig.condition` | `spec.unidirectional`, `link`, `slotContext`, `context.scope`, `context.contexts`, `context.operational`, `^`, `../`, `$context` |
