# Changelog

## 0.2.0 (unreleased)

Navigation between mapping files (phase 2), following the openFHIR IntelliJ plugin.

- Workspace index of every mapping file by `metadata.name` and archetype id, kept up to date as files
  are edited, created or deleted.
- Go to Definition, Find All References and Rename Symbol for `slotArchetype`, `spec.extends`,
  `context.archetypes`, `context.extensions` and `context.start`; the nearest declaration wins.
- Completion of mapping names of the expected file type at those keys, and of method names for
  `appendTo`.
- Hover on a reference shows the file it points at.
- Warnings for names and `appendTo` methods that do not exist in the workspace.

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
