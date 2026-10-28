# Changelog

## 0.1.0 (unreleased)

First version (phase 1), for FHIRConnect grammar v0.9.0.

- Recognises FHIRConnect mapping files by their `grammar: FHIRConnect/...` line.
- Validation: unknown keys (with suggestions), missing required keys, values of the wrong shape,
  invalid enumerated values, extension rules and YAML syntax errors.
- Completion of keys valid in the current block and of enumerated values, with snippets for
  mapping methods, `with`, conditions, `followedBy`, `reference` and manual mappings.
- Hover documentation for keys and path variables, linked to the specification.
- Outline of the header and the tree of mapping methods.
- Command *FHIRConnect: New Mapping File* for model, extension and context files.
