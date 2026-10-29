# Changelog

## 0.3.0 (unreleased)

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
