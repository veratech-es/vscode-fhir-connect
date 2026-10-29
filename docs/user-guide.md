# FHIRConnect for VS Code: user guide

This guide describes everything the extension does, phase by phase. For a one-page summary of the
keyboard shortcuts and features, see the [cheat sheet](cheatsheet.md).

| Version | Phase | Adds |
| --- | --- | --- |
| 0.1.0 | 1 | Validation, completion, hover documentation, outline, *New Mapping File* command |
| 0.2.0 | 2 | Navigation between mapping files: definition, references, rename, name completion, unresolved names |

Shortcuts are the VS Code defaults for Windows and Linux; on macOS use `Cmd` for `Ctrl` and `Option`
for `Alt`. The [cheat sheet](cheatsheet.md) lists both.

## Contents

1. [Getting started](#1-getting-started)
2. [Which files the extension works on](#2-which-files-the-extension-works-on)
3. [Validation](#3-validation)
4. [Completion](#4-completion)
5. [Hover documentation](#5-hover-documentation)
6. [Outline and breadcrumbs](#6-outline-and-breadcrumbs)
7. [New mapping file](#7-new-mapping-file)
8. [Navigation between mapping files](#8-navigation-between-mapping-files)
9. [Settings](#9-settings)
10. [Troubleshooting](#10-troubleshooting)
11. [Diagnostic reference](#11-diagnostic-reference)

## 1. Getting started

### Install

The extension is installed from a `.vsix` file built from this repository:

```shell
npm ci
npm run package
code --install-extension vscode-fhir-connect-0.2.0.vsix
```

On Windows PowerShell, use `npm.cmd` instead of `npm` if the execution policy blocks `npm.ps1`. You
can also install from VS Code: `Ctrl+Shift+P` → *Extensions: Install from VSIX...*. Reload the window
after installing a new version.

`npm ci` may warn that some packages have install scripts that were not run (`esbuild`, `keytar`,
`@vscode/vsce-sign`). The warning is harmless: none of these scripts is needed to build the extension.

### Open a workspace

Open the folder that contains your mapping files (*File* → *Open Folder...*). Navigation between
files (section 8) only sees files inside the open workspace folders, so open the root of the mapping
project, not a single subfolder. To try the extension on real mappings, open
`test/fixtures/mapping-lib-0.9.0`, a copy of the 0.9.0 tag of the
[FHIRconnect mapping library](https://github.com/SevKohler/FHIRconnect-mapping-lib).

## 2. Which files the extension works on

Mapping files stay ordinary YAML files (`.yml` or `.yaml`, language mode *YAML*). The extension only
acts on a YAML file whose top level contains a `grammar: FHIRConnect/...` line, for example:

```yaml
grammar: FHIRConnect/v0.9.0
type: model
metadata:
  name: ACTION.procedure.v1
```

Other YAML files, and other YAML extensions you have installed, are not affected.

### Grammar versions

The extension implements grammar **v0.9.0**, the version executed by the
[openFHIR engine](https://github.com/medblocks/openFHIR). A file that declares another version, such
as `FHIRConnect/v1.0.0`, is recognised: it gets an information message on the `grammar` line, is
indexed for navigation, and is otherwise left alone. Support for v1.0.0 is planned for phase 4.

### File types

The `type` key decides which keys are valid:

| `type` | Purpose | Specific keys |
| --- | --- | --- |
| `model` | Maps one openEHR archetype to a FHIR resource. | `spec.openEhrConfig`, `spec.fhirConfig` |
| `extension` | Adds to, appends to or overwrites the methods of a model mapping. | `spec.extends`, `extension`, `appendTo` |
| `context` | Combines model and extension mappings for one template and profile. | `context` |

## 3. Validation

Problems are reported while you type, as squiggles in the editor and as entries in the *Problems*
panel (`Ctrl+Shift+M`). Use `F8` and `Shift+F8` to jump to the next and previous problem in the
file. Every problem has the source `FHIRConnect` and a code (listed in
[section 11](#11-diagnostic-reference)), so you can filter the *Problems* panel by either.

### What is checked

- **YAML syntax.** Bad indentation, unclosed quotes and similar errors are reported as errors. The
  rest of the file is still checked as far as it parses.
- **Unknown keys.** A key that is not valid in the block it is in is a warning. When it looks like a
  typo of a valid key (at most two characters off), the message suggests the right one:
  ``Unknown key `fhri` in a with. Did you mean `fhir`?``
- **Keys of another file type.** For example `appendTo` in a model file, or `context` in an extension
  file.
- **Missing required keys.** For example a mapping method without `name`, or a model file without
  `spec.openEhrConfig`. The error is reported on the key or list item whose block is incomplete.
- **Wrong shape.** A single value where a map or a list is expected, or the other way round, e.g.
  `with: $resource` instead of a `with:` map.
- **Invalid values.** Keys with a fixed set of values are checked:

  | Key | Allowed values |
  | --- | --- |
  | `type` | `model`, `extension`, `context` |
  | `spec.system` | `FHIR` |
  | `spec.version` | `R4` |
  | `extension` | `add`, `append`, `overwrite` |
  | `unidirectional` | `openEHR->fhir`, `fhir->openehr` (any letter case) |
  | `operator` (conditions) | `one of`, `not of`, `empty`, `not empty`, `type` |
  | boolean keys | `true`, `false` |

- **Empty list items.** A lone `-` in a list is a warning.
- **Rules that span several keys:**
  - In an extension file, every top-level method needs `extension: add`, `append` or `overwrite`;
    the openFHIR engine fails on methods without it.
  - `extension: append` needs `appendTo` with the name of the method to append to.
  - A condition uses either `targetAttribute` or `targetAttributes`, and either `criteria` or
    `criterias`, not both.
- **Unresolved names** (phase 2): references to mapping files or methods that do not exist in the
  workspace. See [section 8.6](#86-unresolved-names).

An empty value (`criteria:` with nothing after it) is not reported; it is left to the engine.

### Quoting values

Values such as `$resource.code` or `one of` do not need quotes. Quote values that YAML would read as
something other than text, such as numbers or booleans, when they must stay text:
`criteria: "524"`, `value: "true"`. Quoted and unquoted names both work for navigation.

### Turning validation off

Set `fhirconnect.validation.enable` to `false` to hide all FHIRConnect problems. Completion, hover
and navigation keep working.

## 4. Completion

Completion opens on its own as you type a key, after `- ` in a list and after `$` in a path. Press
`Ctrl+Space` to open it anywhere else. Completion works from the indentation of the lines around the
cursor, so it keeps working while the file is half written and does not parse.

### Keys

The list shows the keys valid in the block under the cursor that are not already present, filtered by
file type: `extension` and `appendTo` only appear in extension files, `context` only in context
files. Required keys come first and are marked *required*. Each entry shows its documentation in the
details pane (`Ctrl+Space` again toggles it).

Keys with a structure insert it as a snippet. Press `Tab` to move to the next placeholder and
`Shift+Tab` to go back; `Esc` leaves the snippet. For example:

| Key | Inserts |
| --- | --- |
| `with` | `fhir:` and `openehr:` |
| `fhirCondition`, `openehrCondition` | `targetRoot`, `targetAttribute`, `operator`, `criteria` |
| `followedBy`, `reference` | a `mappings:` list with a first child method |
| keys with fixed values | a drop-down of the allowed values |

### Whole list items

Typing `- ` on a new line of a `mappings:` list offers a complete mapping method (`name` and `with`).
The same works for `manual` mappings and for their path / value entries.

### Values

After `key: ` the list offers the allowed values of keys with a fixed set (table in section 3) and,
in `with.fhir`, `with.openehr` and similar paths, the path variables:

| Variable | Side | Meaning |
| --- | --- | --- |
| `$resource` | FHIR | Root of the FHIR resource. |
| `$fhirRoot` | FHIR | FHIR path of the parent mapping method. |
| `$archetype` | openEHR | Root of the mapped archetype. |
| `$openehrRoot` | openEHR | openEHR path of the parent mapping method. |
| `$composition` | openEHR | Root of the composition that contains the archetype. |
| `$reference` | both | No direct path; the method continues in a referenced resource. |

`with.type` offers the data types (`CODEABLECONCEPT`, `QUANTITY`, `DATETIME`, ...).

### Mapping names (phase 2)

Where a value names another mapping file, completion offers the names indexed in the workspace. See
[section 8.4](#84-name-completion).

## 5. Hover documentation

Hover a key to see what it does in the block it is in, and a link to the relevant page of the
[FHIRConnect specification](https://sevkohler.github.io/FHIRconnect-spec/). Hover a path variable
(`$resource`, `$archetype`, ...) to see its meaning. With the keyboard, put the cursor on the word and
press `Ctrl+K Ctrl+I`.

The specification documents grammar v1.0.0. Where v0.9.0 differs, the hover text says so.

Hovering a reference to another mapping file shows that file instead
([section 8.5](#85-hover-on-references)).

## 6. Outline and breadcrumbs

The *Outline* view (in the Explorer side bar) and the breadcrumbs above the editor show the structure
of the file:

- the header keys (`grammar`, `type`, `metadata` with its name, `spec`, ...);
- the tree of mapping methods under `mappings`, including the children in `followedBy`, `reference`
  blocks (labelled with their resource type) and `manual` mappings. Methods of extension files show
  their `extension` mode, and slot methods their `slotArchetype`;
- for context files, the `archetypes` and `extensions` lists.

Press `Ctrl+Shift+O` to jump to a method by name, or type `@:` to see the symbols grouped by kind.
`Ctrl+Shift+.` focuses the breadcrumbs.

## 7. New mapping file

Run *FHIRConnect: New Mapping File* from the command palette (`Ctrl+Shift+P`). Pick the kind of file
(model, extension or context), enter a name, and an untitled YAML file opens with a template that
follows the layout of the mapping library. Fill the placeholders with `Tab`, then save the file
(`Ctrl+S`) with a `.yml` extension inside the workspace.

| Kind | Template contains |
| --- | --- |
| Model | header, `openEhrConfig` (archetype id built from the name), `fhirConfig`, a first method |
| Extension | header, `extends`, a first method with an `extension` drop-down |
| Context | header, `profile`, `template`, `archetypes`, `extensions`, `start` |

## 8. Navigation between mapping files

Phase 2 indexes every mapping file in the workspace and links the files that name each other. It
follows the behaviour of the [openFHIR IntelliJ plugin](https://github.com/openFHIR/intellij-fhir-connect).

### 8.1 Names and references

Every mapping file is known by its `metadata.name`. Model files are also known by their archetype id
(`spec.openEhrConfig.archetype`), so `openEHR-EHR-ACTION.procedure.v1` and `ACTION.procedure.v1`
both find the procedure model.

These values are references to other mapping files:

| Where | Points at |
| --- | --- |
| `slotArchetype` (in a mapping method) | a model file |
| `spec.extends` (in an extension file) | a model file |
| `context.archetypes` items | model files |
| `context.extensions` items | extension files |
| `context.start` | a model file |
| `appendTo` (in an extension file) | a method of the model named in `spec.extends` |

`appendTo` names a method by its `name`. A method nested in `followedBy` or `reference` is named
`parent.child`.

### How a name is resolved

1. Files whose name (or archetype id) is exactly the referenced value. If there are none, the same
   match ignoring letter case.
2. Of those, the files of the expected type (a model for `slotArchetype`, an extension for
   `context.extensions`, ...), if there are any.
3. If several files are left, the ones that share the longest folder path with the current file.
   This lets each project folder have its own file with a common name: in the mapping library,
   `KDS/person/person.context.yaml` and `KDS/person_pseudo/pseudo_person.context.yaml` each find the
   `KDS_gender.yml` of their own folder.
4. If several files are still left, all of them are offered.

The index is built when the workspace opens and is updated as you edit, save, create, delete or
rename files, including changes made outside VS Code.

### 8.2 Go to Definition

Put the cursor on a reference and press `F12`, or `Ctrl+click` it. The referenced file opens at its
`metadata.name`; for `appendTo`, at the `name` of the method. When the name resolves to several files,
VS Code shows them all to pick from. `Alt+F12` (*Peek Definition*) shows the target inline without
leaving the current file. `Alt+Left` goes back.

### 8.3 Find All References

Put the cursor on a `metadata.name`, or on a reference, and press `Shift+F12`. The peek window lists
every place in the workspace that uses that mapping file. `Shift+Alt+F12` shows the same list in the
*References* side panel.

### 8.4 Name completion

Where a reference is typed, completion offers the names of the mapping files of the expected type,
the nearest folders first, each with its path:

- after `slotArchetype: ` and `extends: `, model names;
- after `- ` in `context.archetypes`, model names, and in `context.extensions`, extension names;
- after `start: `, model names;
- after `appendTo: `, the methods of the model named in `spec.extends`.

### 8.5 Hover on references

Hovering a reference shows the type of the referenced file and its path, as a link that opens it.
For `appendTo`, it shows the method and the model file it belongs to.

### 8.6 Unresolved names

A reference that no file in the workspace declares gets a warning:
``No model mapping named `CLUSTER.death_details.v1` in the workspace.`` For `appendTo`:
``No method `x` in the extended model `y`.`` When `spec.extends` itself does not resolve, only
`extends` is reported.

These warnings appear once the whole workspace has been indexed, and update in every open file as you
add, remove or rename mapping files. In the 0.9.0 mapping library six references resolve to nothing;
they are real problems of the library, for example `KDS_Specimen` in
`KDS/diagnose/KDS_diagnose.context.yaml`.

### 8.7 Rename Symbol

Put the cursor on a `metadata.name`, or on a reference, and press `F2`. Type the new name and press
`Enter`: the `metadata.name` and every reference that uses it change together, across files. Press
`Shift+Enter` instead to preview the changes before applying them.

- References made through the archetype id are left alone, since they keep working.
- Rename refuses a name that resolves to several files; rename from the `metadata.name` of the file
  you mean.
- The new name must be a single, non-blank line.
- Edits land in the files but are not saved; *File* → *Save All* (`Ctrl+K S`) saves them, and
  `Ctrl+Z` in each file undoes them.

## 9. Settings

Open the settings with `Ctrl+,` and search for `fhirconnect`.

| Setting | Default | Description |
| --- | --- | --- |
| `fhirconnect.validation.enable` | `true` | Report grammar problems and unresolved names in mapping files. |
| `fhirconnect.trace.server` | `off` | Trace the communication with the language server (`messages`, `verbose`) in the *FHIRConnect* output channel. |

## 10. Troubleshooting

| Symptom | Check |
| --- | --- |
| Nothing happens in a mapping file | The language mode in the status bar is *YAML*, and the file has a top-level `grammar: FHIRConnect/...` line. |
| Only an information message on `grammar` | The file declares a grammar version other than v0.9.0. |
| F12 or name completion finds nothing | The target file is inside the open workspace folder and has a `metadata.name`. |
| Many "no mapping named" warnings | The workspace is a subfolder of the project; open the project root. |
| Another YAML extension reports schema errors on mapping files | That extension validates all YAML; turn off its schema for these files. |
| A new version does not show up | Reload the window (`Ctrl+Shift+P` → *Developer: Reload Window*). |
| Something looks wrong | Set `fhirconnect.trace.server` to `verbose` and look at *View* → *Output* → *FHIRConnect*. |

## 11. Diagnostic reference

| Code | Severity | Meaning |
| --- | --- | --- |
| `yaml-syntax` | Error | The YAML does not parse at this point. |
| `not-a-map` | Error | The file is not a YAML map. |
| `unsupported-grammar` | Information | Grammar version not implemented yet; the file is not validated. |
| `unknown-key` | Warning | Key not valid in this block, with a suggestion when it looks like a typo. |
| `wrong-file-type` | Warning | Key used in a file type it does not belong to. |
| `missing-key` | Error | A required key is missing. |
| `wrong-shape` | Error | A value where a map or list is expected, or the other way round. |
| `wrong-type` | Error | A boolean key with a value other than `true` or `false`. |
| `invalid-value` | Warning | Value outside the allowed set of the key. |
| `empty-item` | Warning | Empty list item. |
| `missing-extension` | Warning | Top-level method of an extension file without `extension`. |
| `missing-append-to` | Warning | `extension: append` without `appendTo`. |
| `conflicting-keys` | Warning | `targetAttribute` with `targetAttributes`, or `criteria` with `criterias`. |
| `unresolved-reference` | Warning | No mapping file of the expected type has this name. |
| `unresolved-method` | Warning | The extended model has no method with this `appendTo` name. |
