# FHIRConnect for Visual Studio Code

Editing support for [FHIRConnect](https://sevkohler.github.io/FHIRconnect-spec/) mapping files, the
YAML mapping language for bidirectional transformation between openEHR and FHIR.

This first version supports grammar **v0.9.0**, the version executed by the
[openFHIR engine](https://github.com/medblocks/openFHIR). Files with another grammar version are
recognised but not validated yet.

## Documentation

- [User guide](docs/user-guide.md): every feature in detail, settings, troubleshooting and the list of
  diagnostics.
- [Cheat sheet](docs/cheatsheet.md): keyboard shortcuts and features on one page.

## Features

- **Validation** while you type: unknown keys (with a "did you mean" suggestion), missing required
  keys, values of the wrong shape (a value where a map or list is expected), invalid values for
  `type`, `operator`, `extension`, `unidirectional`, `system` and `version`, and YAML syntax errors.
  Extension files are checked for `spec.extends`, `extension:` on every top-level method and
  `appendTo` on `append` methods.
- **Completion** of the keys valid in the current block, filtered by file type (`extension` and
  `appendTo` only in extension files, `context` only in context files). Keys with a structure insert
  it as a snippet: `with` adds `fhir` / `openehr`, `fhirCondition` adds `targetRoot`, `operator`, …,
  `followedBy` and `reference` add a first child method. A new `- ` in a `mappings:` list offers a
  whole mapping method.
- **Value completion** for enumerated values and for path variables (`$resource`, `$fhirRoot`,
  `$archetype`, `$openehrRoot`, `$composition`, `$reference`).
- **Hover documentation** for every key, specific to the block it is in, with a link to the
  specification page, and for path variables.
- **Outline** and breadcrumbs: header sections and the tree of mapping methods, including
  `followedBy` children, `reference` blocks and manual mappings.
- **Navigation between mapping files**, as in the
  [openFHIR IntelliJ plugin](https://github.com/openFHIR/intellij-fhir-connect). Every mapping file in
  the workspace is indexed by its `metadata.name` (and, for models, its archetype id). On the reference
  sites `slotArchetype`, `spec.extends`, `context.archetypes`, `context.extensions` and
  `context.start`:
  - **Go to Definition** (F12 / Ctrl+click) opens the mapping file. When the name is declared in
    several folders, the file sharing the longest folder path with the current file wins; ties are
    all offered.
  - **Find All References** (Shift+F12), from a reference or from a `metadata.name`, lists every file
    that uses the mapping.
  - **Rename Symbol** (F2) renames a mapping and updates every reference to it.
  - **Completion** offers the mapping names of the expected type (models for `slotArchetype`,
    extensions for `context.extensions`, …), nearest first.
  - **Hover** shows which file the reference points at.
  - A **warning** marks names that no file in the workspace declares.
  - `appendTo` jumps to, completes and checks the method of the model named in `spec.extends`
    (`parent.child` for nested methods).
- **New mapping file** command (*FHIRConnect: New Mapping File*) for model, extension and context
  files.

## Which files are FHIRConnect files

Mapping files stay ordinary `.yml` / `.yaml` files. The extension only acts on YAML files with a
top-level `grammar: FHIRConnect/...` line, so other YAML files and other YAML extensions are not
affected.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `fhirconnect.validation.enable` | `true` | Report grammar problems in mapping files. |
| `fhirconnect.trace.server` | `off` | Trace the communication with the language server. |

## Install from a `.vsix`

```shell
npm ci
npm run package                      # creates vscode-fhir-connect-<version>.vsix
code --install-extension vscode-fhir-connect-0.2.0.vsix
```

Or in VS Code: *Extensions* view → `…` → *Install from VSIX…*.

## Development

Requires Node.js 20 or newer.

```shell
npm ci
npm run build       # bundles dist/extension.js and dist/server.js
npm run watch       # rebuilds on change
npm run typecheck
npm test            # unit tests and the mapping library corpus
```

Press F5 in VS Code with the *Run Extension* configuration to start an Extension Development Host.

Every phase that adds or changes a feature updates the [user guide](docs/user-guide.md) and the
[cheat sheet](docs/cheatsheet.md) in the same pull request.

The extension is a thin client (`src/client`) that starts a language server (`src/server`):

| Module | Role |
| --- | --- |
| `server/grammar` | The grammar as data: which keys each block allows, their value shape, allowed values, documentation and snippets. Validation, completion and hover all read it. One file per grammar version. |
| `server/document.ts` | Detects FHIRConnect files and parses them with the `yaml` library. |
| `server/validation.ts` | Walks the YAML tree against the grammar. |
| `server/cursor.ts` | Works out the block under the cursor from indentation, so completion works in files that do not parse yet. |
| `server/workspace.ts`, `scan.ts` | The workspace index: names, references and methods of every mapping file, and how a name resolves. |
| `server/completion.ts`, `hover.ts`, `symbols.ts` | The language features. |

`test/fixtures/mapping-lib-0.9.0` holds the 75 mapping files of the 0.9.0 tag of the
[FHIRconnect mapping library](https://github.com/SevKohler/FHIRconnect-mapping-lib). The corpus test
requires them to validate without errors; the warnings they produce, and the references that resolve
to nothing, are kept in snapshots.

## Roadmap

1. **Phase 1 (0.1.0):** validation, completion, hover, outline, new file command.
2. **Phase 2 (0.2.0):** navigation between mapping files: definition, references, rename, name
   completion and unresolved names.
3. **Phase 3:** openEHR templates and FHIR StructureDefinitions: path resolution, path completion and
   path diagnostics.
4. **Phase 4:** running mappings against the openFHIR engine, grammar v1.0.0, AQL conversion.

## License

[Apache License 2.0](LICENSE). See [NOTICE](NOTICE) for third-party material.
