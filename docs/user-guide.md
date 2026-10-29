# FHIRConnect for VS Code: user guide

This guide describes everything the extension does, phase by phase. For a one-page summary of the
keyboard shortcuts and features, see the [cheat sheet](cheatsheet.md).

| Version | Phase | Adds |
| --- | --- | --- |
| 0.1.0 | 1 | Validation, completion, hover documentation, outline, *New Mapping File* command |
| 0.2.0 | 2 | Navigation between mapping files: definition, references, rename, name completion, unresolved names |
| 0.3.0 | 3 | Paths against templates and FHIR R4: hover, inlay hints, path completion, Go to Definition into the template, path warnings |

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
9. [Paths against templates and FHIR R4](#9-paths-against-templates-and-fhir-r4)
10. [Settings](#10-settings)
11. [Troubleshooting](#11-troubleshooting)
12. [Diagnostic reference](#12-diagnostic-reference)

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
[section 12](#12-diagnostic-reference)), so you can filter the *Problems* panel by either.

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

## 9. Paths against templates and FHIR R4

From phase 3 the extension reads the paths of every mapping method (`with.fhir`, `with.openehr`,
conditions, `manual` entries) and works out what each one points at: an element of a FHIR R4 type on
one side, a node of an openEHR operational template on the other. This drives hover, inlay hints,
path completion, Go to Definition into the template and path warnings.

### 9.1 Where the models come from

| Side | Source | What you need to do |
| --- | --- | --- |
| FHIR | The FHIR R4 (4.0.1) resources and data types, bundled with the extension | Nothing. `spec.fhirConfig.structureDefinition` picks the root resource. |
| FHIR profiles | StructureDefinition `.json` files in the workspace | Optional. A profile URL in `structureDefinition` resolves to the type the profile constrains. |
| openEHR | Operational templates (`.opt`, OPT 1.4 XML) in the workspace | Put the templates of your project somewhere in the workspace folder. |
| openEHR archetypes | ADL 1.4 archetypes (`.adl`) in the workspace | Optional. Only for *Go to Archetype Definition* ([9.7](#97-go-to-the-archetype-adl)). |

The extension scans the whole workspace for `.opt` and `.adl` files and for `.json` files that contain a
StructureDefinition, and follows changes to them. Web templates (`.json` from the openEHR web template
format) are not read; export the OPT instead.

A model mapping is checked against every template that contains its archetype
(`spec.openEhrConfig.archetype`), so the same model works for all the templates that use it. When no
template in the workspace contains the archetype, its openEHR paths stay unchecked and an information
message on `archetype` says so. When the workspace has no templates at all, nothing is reported on the
openEHR side.

### 9.2 How a path is read

The extension follows the openFHIR engine (grammar v0.9.0):

| Path | Starts from |
| --- | --- |
| `$resource.code` | The root resource of the model (`structureDefinition`). |
| `$fhirRoot.code`, `code` | The FHIR path of the parent method. A relative path is `parent.child`. |
| `$archetype/data[at0001]` | The archetype root. |
| `$composition/context` | The root COMPOSITION of the template. |
| `$openehrRoot/...`, `items[at0004]` | The openEHR path of the parent method. A relative path is `parent/child`. |
| `$reference` | Transparent: the children of a `reference` block keep the parent's openEHR context, and their FHIR paths start from the referenced resource. |

More rules the engine applies, and the extension with it:

- **Slot models** (`slotArchetype`): `$resource` and `$fhirRoot` are the FHIR path of the method that
  calls the slot, and `$archetype` its openEHR path. A model used both on its own and as a slot accepts
  both.
- **Conditions** (`fhirCondition`, `openehrCondition`) start from the parent method, and
  `targetAttribute` is relative to `targetRoot`.
- **Manual mappings**: `path` values are relative to the method's own paths.
- **Extensions**: `add` methods start at the model root; `overwrite` methods replace a method of the
  extended model (found by name at any level) and take its parent; `append` methods take the
  `appendTo` method's context.
- **Implicit steps**: like the engine, a path may stop at an `ELEMENT` and go on as if it named its
  `value`, and at a `DV_CODED_TEXT` as if it named its `defining_code`. Hover shows the implicit step.
- **Lenient fallback**: when a relative path does not resolve from the parent, it is tried from the
  ancestors and from the archetype root, as mappings in the library often repeat the parent prefix.
- **FHIR functions**: `as(T)` / `ofType(T)` cast a choice (also written `valueQuantity`), `resolve()`
  follows a Reference, `where(...)`, `first()` and `extension(url)` keep the type. Casts accept the
  FHIRPath names (`dateTime`) and the HAPI class names the engine accepts (`DateTimeType`).
- A **`|suffix`** on an openEHR path (`|code`, `|magnitude`) ends the check: the part after `|` is a
  web template attribute, not a template node.

Anything the extension cannot follow (an unfilled slot, an unknown function, a profile that is not in
the workspace) is left alone: no warning, no hover, no hint.

### 9.3 Hover on a path

Hover over any segment of a path to see what it resolves to.

- openEHR: `**label** · RM type · min..max`, the node description, the archetype code and template,
  and the full resolved path. When several templates contain the archetype, the first three nodes are listed.
- An RM attribute (`value`, `defining_code`, …): its type and the RM class that declares it.
- FHIR: the element, its type(s), cardinality and short description, and the resolved path
  (`Observation.code.coding`).

Hover over `context.template.id`, `spec.fhirConfig.structureDefinition` or `context.profile.url` to see
which template or StructureDefinition the value names.

### 9.4 Inlay hints

At the end of every `with.fhir` and `with.openehr` line, a grey hint shows what the path resolved to:
the node label and RM type on the openEHR side (`Labortest-Kategorie · ELEMENT`), the type on the FHIR
side, with `[]` when the element repeats (`CodeableConcept[]`). Turn them off with
`fhirconnect.inlayHints.enable`, or for all languages with `editor.inlayHints.enabled`
(`Ctrl+Alt` held shows them while they are set to *offUnlessPressed*).

### 9.5 Path completion

`Ctrl+Space` inside a path value offers the next segment:

- openEHR: the child nodes of the current node as `attribute[code]`, labelled with the node text
  (type the label to filter), with a `name/value` predicate when two siblings share a code; then the
  RM attributes of the node's class (`value`, `defining_code`, `null_flavour`, …).
- FHIR: the elements of the current type with type and cardinality, and `as(T)` for each type of a
  choice element.
- Inside `as(` / `ofType(`: the types the element can be cast to, plus the resources a Reference may
  point at (`$resource.encounter.as(` offers `Reference` and `Encounter`).
- Path variables (`$archetype`, `$resource`, …) at the start of the value, as in phase 1.

### 9.6 Go to Definition into the model

`F12` (or `Ctrl+click`) on a segment of an openEHR path opens the template at that node. On
`context.template.id` it opens the template, and on a `structureDefinition` or `context.profile.url`
that names a workspace profile it opens the StructureDefinition file. FHIR core types have no file to
open.

### 9.7 Go to the archetype (ADL)

`F12` goes to the node in the template (OPT). When the source archetypes (`.adl`, ADL 1.4) are also in
the workspace, a second shortcut goes to the same node in the archetype instead:

| Action | Windows / Linux | macOS |
| --- | --- | --- |
| Go to Archetype Definition | `Ctrl+Alt+F12` | `Cmd+Option+F12` |
| Peek Archetype Definition | `Ctrl+Shift+Alt+F12` | `Cmd+Shift+Option+F12` |

Both commands are also in the command palette (*FHIRConnect: Go to Archetype Definition*,
*FHIRConnect: Peek Archetype Definition*), and the first one is in the editor context menu of mapping
files.

- On a segment of an openEHR path, the command opens the archetype that owns the node, at the node
  (`ELEMENT[at0005]`). A slot step (`items[openEHR-EHR-CLUSTER.…]`) opens the archetype that fills
  the slot, at its root.
- On an RM attribute (`value`, `defining_code`) or a node without its own code, it goes to the
  nearest coded node before it.
- On `spec.openEhrConfig.archetype`, it opens the archetype at its root node.
- The archetype is found by its id (the `archetype_id` in the ADL header), wherever the file is in the
  workspace. When no `.adl` with that id exists, a message says so.

The at-codes are taken from the template, so an archetype revision that renumbered its nodes can
land on a different node, or on the root when the code is missing.

To change the shortcuts, open *File* → *Preferences* → *Keyboard Shortcuts* (`Ctrl+K Ctrl+S`) and search
for `fhirconnect`.

### 9.8 Path warnings

A warning marks the first segment that does not resolve; the rest of the path is not checked. See the
[diagnostic reference](#12-diagnostic-reference) for the codes. Turn path checks off, while keeping
grammar validation, with `fhirconnect.validation.paths`.

## 10. Settings

Open the settings with `Ctrl+,` and search for `fhirconnect`.

| Setting | Default | Description |
| --- | --- | --- |
| `fhirconnect.validation.enable` | `true` | Report grammar problems and unresolved names in mapping files. |
| `fhirconnect.validation.paths` | `true` | Check FHIR and openEHR paths against FHIR R4 and the workspace templates. |
| `fhirconnect.inlayHints.enable` | `true` | Show what each `with` path resolves to at the end of the line. |
| `fhirconnect.trace.server` | `off` | Trace the communication with the language server (`messages`, `verbose`) in the *FHIRConnect* output channel. |

## 11. Troubleshooting

| Symptom | Check |
| --- | --- |
| Nothing happens in a mapping file | The language mode in the status bar is *YAML*, and the file has a top-level `grammar: FHIRConnect/...` line. |
| Only an information message on `grammar` | The file declares a grammar version other than v0.9.0. |
| F12 or name completion finds nothing | The target file is inside the open workspace folder and has a `metadata.name`. |
| Many "no mapping named" warnings | The workspace is a subfolder of the project; open the project root. |
| Another YAML extension reports schema errors on mapping files | That extension validates all YAML; turn off its schema for these files. |
| No hover or hint on openEHR paths | A `.opt` containing the model's archetype is in the workspace (look for the `archetype-not-in-templates` information). Web templates are not read. |
| No hover on a FHIR path after a profile URL | The StructureDefinition `.json` is in the workspace and its `url` matches. |
| A path warning you believe is wrong | Check the segment in the template (`F12` on the previous segment) and the engine rules in [9.2](#92-how-a-path-is-read). |
| `Ctrl+Alt+F12` says no ADL archetype was found | The `.adl` file (ADL 1.4; ADL 2 `.adls` is not read) is in the workspace and its header names the same archetype id. |
| Inlay hints clutter the editor | Set `fhirconnect.inlayHints.enable` to `false`. |
| A new version does not show up | Reload the window (`Ctrl+Shift+P` → *Developer: Reload Window*). |
| Something looks wrong | Set `fhirconnect.trace.server` to `verbose` and look at *View* → *Output* → *FHIRConnect*. |

## 12. Diagnostic reference

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
| `archetype-not-in-templates` | Information | No workspace template contains the model's archetype; openEHR paths are not checked. |
| `unknown-openehr-node` | Warning | No child node of the template matches this segment (code or name). |
| `unknown-rm-attribute` | Warning | The RM class of the node has no attribute with this name. |
| `unknown-fhir-element` | Warning | The FHIR type has no element with this name. |
| `unknown-fhir-type` | Warning | `as(...)` / `ofType(...)` names something that is not a FHIR R4 type. |
| `impossible-fhir-type` | Warning | The cast type is not one of the element's types. |
| `unresolved-overwrite` | Warning | An `overwrite` method names no method of the extended model; the engine skips it. |
