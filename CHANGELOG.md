# Changelog

## 0.5.1 (unreleased)

- Ready for the Visual Studio Marketplace and Open VSX (not published yet): extension icon
  (`images/icon.png`), Marketplace banner colour, more keywords, and
  [docs/publishing.md](docs/publishing.md) with the publisher setup and the release steps.
- Documentation review: the README lists the openFHIR settings and commands, the cheat sheet the
  *Peek Archetype Definition*, *Check openFHIR Connection* and *Set openFHIR Token* commands and the
  Explorer context menu. The user guide and the cheat sheet no longer mention the development
  phases nor an old `.vsix` version; the version history is in this change log.
- The repository moved to [veratech-es/vscode-fhir-connect](https://github.com/veratech-es/vscode-fhir-connect);
  `package.json` now points `repository`, `bugs` and `homepage` there.
- The publisher is now `veratech-es`, so the extension ID changes to
  `veratech-es.vscode-fhir-connect`. Uninstall the old `damoca.vscode-fhir-connect` before
  installing the new `.vsix`; `fhirconnect.*` settings are kept.

## 0.5.0 (unreleased)

Running mappings with an openFHIR engine (phase 5). The engine (openFHIR 3.0.3 or later) runs
outside the extension, for example with `docs/openfhir/docker-compose.yml`.

- *FHIRConnect: Run Mapping to openEHR* sends the open FHIR resource or Bundle to `$toopenehr` and
  opens the Composition beside it, canonical or flat (`fhirconnect.openfhir.format`).
- *FHIRConnect: Run Mapping to FHIR* sends the open canonical or flat Composition to `$tofhir` and
  opens the Bundle beside it.
- Both ask for the template among the context mappings of the workspace and remember it per file;
  play buttons on JSON files the engine can map.
- The engine reloads its bootstrap folder (`POST /$bootstrap`) when a mapping file or `.opt` is
  saved, or with *FHIRConnect: Sync Mappings with openFHIR*; files it cannot load are reported in
  *Problems*.
- Issues of the engine's `OperationOutcome` appear in *Problems* on the input file and in the
  *FHIRConnect openFHIR* output channel.
- *openFHIR* status bar item and *FHIRConnect: Check openFHIR Connection*; *FHIRConnect: Set openFHIR
  Token* keeps a bearer token in the VS Code secret storage; confirmation before the first file goes
  to an engine that is not on this computer.
- Settings `fhirconnect.openfhir.url`, `syncOnSave`, `bootstrapFolder` and `format`.

## 0.4.0

Grammar FHIRConnect v1.0.0 and the *Mapping Context* view (phase 4). Files in v0.9.0 keep working;
each file is checked with the version its `grammar` line declares.

- Grammar v1.0.0: `spec.unidirectional`, `link` (`meaning`, `type`), `slotContext`,
  `context.scope`, `context.contexts`, `context.operational` and `$context` in manual values;
  `fhirConfig.multiple` and `fhirConfig.condition` are no longer accepted.
- Path operators of v1.0.0: `^` goes one element back up the parent's FHIR path and `../` one step
  back up the parent's openEHR path. In v0.9.0 files they are reported.
- References `slotContext`, `context.contexts` and `context.operational` take part in Go to
  Definition, Find All References, rename, completion and unresolved-name warnings.
- Slot models entered through `slotContext` get their path roots from the calling method; manual
  paths accept `$fhirRoot` and `$openehrRoot`.
- New diagnostics: `slotArchetype` together with `slotContext`, and `slotContext` with
  `openehr: $reference`.
- *FHIRConnect Mapping Context* view in the Explorer (`Ctrl+Alt+M`): the method at the cursor, its
  parent chain, resolved FHIR and openEHR nodes, slot targets and the extensions that change it; the
  file's profile, archetype, templates, extensions, contexts and the models that use it as a slot.
- *FHIRConnect: New Mapping File* asks for the grammar version (v1.0.0 by default).

## 0.3.0

Path resolution against openEHR templates and FHIR R4 (phase 3), following the rules of the openFHIR
engine.

- Reads the operational templates (`.opt`) and StructureDefinitions (`.json`) of the workspace, and
  ships an index of the FHIR R4 (4.0.1) resources and data types.
- Resolves every FHIR and openEHR path of model and extension files: `with`, conditions and manual
  entries, through `$resource`, `$fhirRoot`, `$archetype`, `$composition`, `$openehrRoot`,
  `followedBy`, `reference`, slot archetypes and extension modes (`add`, `overwrite`, `append`).
- Warnings for FHIR elements, casts, template nodes and RM attributes that do not exist, for
  `overwrite` methods the engine cannot find, and a note when no template contains the archetype.
- Hover on a path step: template node with label, description, RM type and occurrences, or FHIR
  element with type, cardinality and description, plus the full resolved path.
- Inlay hints after each `with` path with the openEHR node and the FHIR type.
- Completion of the next path step: template nodes (searchable by label and at-code), RM attributes,
  FHIR elements and the casts of choice elements.
- Go to Definition from an openEHR path step to its node in the template, from `context.template.id`
  to the template, and from a profile URL to its StructureDefinition.
- *FHIRConnect: Go to Archetype Definition* (`Ctrl+Alt+F12`) and *Peek Archetype Definition*
  (`Ctrl+Shift+Alt+F12`): the same node in the ADL 1.4 archetype (`.adl`) of the workspace.
- Settings `fhirconnect.validation.paths` and `fhirconnect.inlayHints.enable`.

## 0.2.0

Navigation between mapping files (phase 2), following the openFHIR IntelliJ plugin.

- Workspace index of every mapping file by `metadata.name` and archetype id, kept up to date as files
  are edited, created or deleted.
- Go to Definition, Find All References and Rename Symbol for `slotArchetype`, `spec.extends`,
  `context.archetypes`, `context.extensions` and `context.start`; the nearest declaration wins.
- Completion of mapping names of the expected file type at those keys, and of method names for
  `appendTo`.
- Hover on a reference shows the file it points at.
- Warnings for names and `appendTo` methods that do not exist in the workspace.
- User guide (`docs/user-guide.md`) and cheat sheet (`docs/cheatsheet.md`) covering phases 1 and 2.

## 0.1.0

First version (phase 1), for FHIRConnect grammar v0.9.0.

- Recognises FHIRConnect mapping files by their `grammar: FHIRConnect/...` line.
- Validation: unknown keys (with suggestions), missing required keys, values of the wrong shape,
  invalid enumerated values, extension rules and YAML syntax errors.
- Completion of keys valid in the current block and of enumerated values, with snippets for
  mapping methods, `with`, conditions, `followedBy`, `reference` and manual mappings.
- Hover documentation for keys and path variables, linked to the specification.
- Outline of the header and the tree of mapping methods.
- Command *FHIRConnect: New Mapping File* for model, extension and context files.
