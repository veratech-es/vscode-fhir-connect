# FHIRConnect for Visual Studio Code

Editing support for [FHIRConnect](https://sevkohler.github.io/FHIRconnect-spec/) mapping files, the
YAML mapping language for bidirectional transformation between openEHR and FHIR.

The extension supports grammar **v0.9.0** and **v1.0.0**, the version of the specification and of
the current mapping library. Each file is checked with the version it declares. With an
[openFHIR engine](https://github.com/openFHIR/openfhir) running in Docker, it also runs the mappings
on a FHIR resource or an openEHR Composition and shows the result.

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
- **Paths against templates and FHIR R4**: the FHIR and openEHR paths of every method are resolved
  the way the openFHIR engine reads them, against the FHIR R4 definitions (bundled) and the
  operational templates (`.opt`) and StructureDefinitions found in the workspace.
  - **Hover** on a path segment: node label, RM type, cardinality and template, or FHIR element type
    and cardinality, with the full resolved path.
  - **Inlay hints** after each `with` path (`Labortest-Kategorie · ELEMENT`, `CodeableConcept[]`).
  - **Completion** of the next segment: child nodes as `attribute[code]` (filter by label), RM
    attributes, FHIR elements and `as(T)` casts.
  - **Go to Definition** from an openEHR segment or `context.template.id` into the template, and from
    a profile URL into the StructureDefinition.
  - **Go to Archetype Definition** (Ctrl+Alt+F12, peek with Ctrl+Shift+Alt+F12) opens the same node
    in the ADL 1.4 archetype (`.adl`) when the archetypes are in the workspace.
  - **Warnings** on the first segment that does not resolve, and on `overwrite` methods that replace
    nothing.
- **Mapping Context** view (Explorer side bar, Ctrl+Alt+M): the method at the cursor with its
  resolved FHIR and openEHR paths and the extension methods that change it, and how the file fits in
  the project: extended model, extensions, slots and contexts that use it, templates of its
  archetype. In a context file, what the context loads.
- **Running mappings with openFHIR**: *Run Mapping to openEHR* and *Run Mapping to FHIR* send the
  open FHIR resource or Composition to an openFHIR engine (3.0.3 or later) and open the result beside
  it, with the engine's issues in *Problems*. The engine reloads the mapping files on save. See
  [`docs/openfhir/docker-compose.yml`](docs/openfhir/docker-compose.yml) to start it.
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
| `fhirconnect.validation.paths` | `true` | Check paths against FHIR R4 and the workspace templates. |
| `fhirconnect.inlayHints.enable` | `true` | Show what each `with` path resolves to. |
| `fhirconnect.trace.server` | `off` | Trace the communication with the language server. |

## Install from a `.vsix`

```shell
npm ci
npm run package                      # creates vscode-fhir-connect-<version>.vsix
code --install-extension vscode-fhir-connect-0.5.0.vsix
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
| `server/grammar` | The grammar as data: which keys each block allows, their value shape, allowed values, documentation and snippets. Validation, completion and hover all read it. One file per grammar version (`v0_9_0.ts`, and `v1_0_0.ts` as a list of changes to it). |
| `server/document.ts` | Detects FHIRConnect files and parses them with the `yaml` library. |
| `server/validation.ts` | Walks the YAML tree against the grammar. |
| `server/cursor.ts` | Works out the block under the cursor from indentation, so completion works in files that do not parse yet. |
| `server/workspace.ts`, `scan.ts` | The workspace index: names, references and methods of every mapping file, and how a name resolves. |
| `server/models` | The FHIR R4 index (`fhir-r4.json`), StructureDefinition profiles, the OPT and ADL readers and the openEHR RM classes. |
| `server/paths` | Path syntax, the resolver (engine semantics per method) and the path features: hover, hints, completion, definition. |
| `server/completion.ts`, `hover.ts`, `symbols.ts` | The language features. |
| `server/mappingContext.ts`, `client/contextView.ts` | The Mapping Context view: the tree is built by the server, the client shows it. |
| `client/openfhir/client.ts`, `client/openfhir/feature.ts` | The openFHIR HTTP client (no VS Code dependency, tested against a fake engine) and the commands, sync, status bar and diagnostics built on it. |

`server/models/fhir-r4.json` is generated from the official FHIR R4 (4.0.1) definition bundles
`profiles-resources.json` and `profiles-types.json`:

```shell
node scripts/build-fhir-index.mjs <folder with the two bundles>
```

`test/fixtures/mapping-lib-0.9.0` holds the 75 mapping files of the 0.9.0 tag of the
[FHIRconnect mapping library](https://github.com/SevKohler/FHIRconnect-mapping-lib). The corpus test
requires them to validate without errors; the warnings they produce, and the references that resolve
to nothing, are kept in snapshots. The fixture also holds the 12 KDS operational templates of the library (main branch), so the path
test resolves the library's paths and snapshots the ones that do not resolve.
`test/fixtures/mapping-lib-1.0.0` holds the 106 mapping files and the operational templates of the
main branch of the same library, written in grammar v1.0.0; the same corpus, reference and path
tests run on it.

## Roadmap

1. **Phase 1 (0.1.0):** validation, completion, hover, outline, new file command.
2. **Phase 2 (0.2.0):** navigation between mapping files: definition, references, rename, name
   completion and unresolved names.
3. **Phase 3 (0.3.0):** openEHR templates and FHIR StructureDefinitions: path resolution, hover,
   inlay hints, path completion, Go to Definition into the template and path diagnostics.
4. **Phase 4 (0.4.0):** grammar v1.0.0 next to v0.9.0 (`link`, `slotContext`, sub-contexts,
   operational mappings, `^` and `../`), and the Mapping Context view.
5. **Phase 5 (0.5.0):** running mappings with a local openFHIR engine: sync on save, *Run Mapping
   to openEHR* / *to FHIR*, engine issues in *Problems*.
6. **Later:** AQL conversion, web templates, ADL 2.

## License

[Apache License 2.0](LICENSE). See [NOTICE](NOTICE) for third-party material.
