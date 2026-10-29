# FHIRConnect for VS Code: cheat sheet

Version 0.2.0 (phases 1 and 2). The [user guide](user-guide.md) explains each feature in detail.

The extension acts on `.yml` / `.yaml` files with a top-level `grammar: FHIRConnect/v0.9.0` line.

## Keyboard shortcuts

| Action | Windows / Linux | macOS | Works on |
| --- | --- | --- | --- |
| Open completion | `Ctrl+Space` | `Ctrl+Space` | keys, values, `$` variables, mapping names |
| Show or hide completion details | `Ctrl+Space` (list open) | `Ctrl+Space` (list open) | completion list |
| Next / previous snippet placeholder | `Tab` / `Shift+Tab` | `Tab` / `Shift+Tab` | inserted snippets |
| Show hover | `Ctrl+K Ctrl+I` | `Cmd+K Cmd+I` | keys, variables, references |
| Go to Definition | `F12` or `Ctrl+click` | `F12` or `Cmd+click` | references, `appendTo` |
| Peek Definition | `Alt+F12` | `Option+F12` | references, `appendTo` |
| Go back | `Alt+Left` | `Ctrl+-` | after a jump |
| Find All References (peek) | `Shift+F12` | `Shift+F12` | `metadata.name`, references |
| Find All References (panel) | `Shift+Alt+F12` | `Shift+Option+F12` | `metadata.name`, references |
| Rename Symbol | `F2` | `F2` | `metadata.name`, references |
| Preview a rename | `Shift+Enter` in the rename box | `Shift+Enter` in the rename box | rename |
| Go to method in file | `Ctrl+Shift+O` | `Cmd+Shift+O` | outline |
| Focus breadcrumbs | `Ctrl+Shift+.` | `Cmd+Shift+.` | outline |
| Problems panel | `Ctrl+Shift+M` | `Cmd+Shift+M` | validation |
| Next / previous problem | `F8` / `Shift+F8` | `F8` / `Shift+F8` | validation |
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

## Reference sites

| Key | Points at |
| --- | --- |
| `slotArchetype` | model |
| `spec.extends` | model |
| `context.archetypes` items | model |
| `context.extensions` items | extension |
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
| `unidirectional` | `openEHR->fhir`, `fhir->openehr` |
| `operator` | `one of`, `not of`, `empty`, `not empty`, `type` |
| FHIR variables | `$resource`, `$fhirRoot`, `$reference` |
| openEHR variables | `$archetype`, `$openehrRoot`, `$composition`, `$reference` |

Quote values YAML would read as numbers or booleans: `criteria: "524"`.

## Settings

| Setting | Default |
| --- | --- |
| `fhirconnect.validation.enable` | `true` |
| `fhirconnect.trace.server` | `off` |
