# fedramp-cr26-oscal

Unofficial tooling for representing the FedRAMP Consolidated Rules for 2026
Public Preview as OSCAL.

This repository is not affiliated with, endorsed by, or sponsored by FedRAMP,
GSA, NIST, or the OSCAL project.

## Why This Exists

FedRAMP CR26 is already machine-readable in its own JSON format. OSCAL provides
the broader exchange framework for catalogs, profiles, implementation
statements, assessment results, POA&Ms, and control mappings.

## Modeling Approach

The current architecture uses a CR26 catalog as the source artifact, separate
20x and Rev5 profile shells over that catalog, and an OSCAL mapping collection
to describe relationships to NIST SP 800-53 Rev5. The mapping collection is
thought to become the semantic binding layer that lets an implementation or
assessment remain attached to NIST controls and statements while still producing
a KSI-oriented FedRAMP 20x or Rev5 viewpoint.

Mappings are oriented from NIST SP 800-53 Rev5 controls or statements to CR26
rules and KSIs. Under the proof-of-concept assumption, the relevant NIST source
set may be modeled as a `superset-of` the CR26/KSI target. The inverse claim is
not made.

The project emits a single mapping collection containing both control-level and
statement-level maps. The control-level maps preserve the CR26 source
references for discovery and coverage analysis. The statement-level maps expand
those NIST control references through the NIST OSCAL catalog so
assessment-oriented work can bind to specific OSCAL statement IDs.

Source-provided artifact requirements, including CR26 `default_artifacts` and
rule/KSI-specific `artifacts`, are preserved in the generated catalog as
addressable `part` content. These are requirement-side statements about what
must be supplied; they are not submitted evidence, SSP responses, or assessment
results.

## Status

Experimental. The FedRAMP CR26 source data is Public Preview material and may
change. Generated OSCAL artifacts should be treated as draft analysis aids, not
official FedRAMP guidance.

## Quick Start

```bash
bun test
bun run generate -- --out out
```

Generated files:

```text
out/FedRAMP/catalog/xml/FedRAMP_CR26_catalog.xml
out/FedRAMP/catalog/json/FedRAMP_CR26_catalog.json
out/FedRAMP/catalog/yaml/FedRAMP_CR26_catalog.yaml
out/FedRAMP/profile/20x/xml/FedRAMP_20x_profile.xml
out/FedRAMP/profile/20x/json/FedRAMP_20x_profile.json
out/FedRAMP/profile/20x/yaml/FedRAMP_20x_profile.yaml
out/FedRAMP/profile/rev5/xml/FedRAMP_rev5_profile.xml
out/FedRAMP/profile/rev5/json/FedRAMP_rev5_profile.json
out/FedRAMP/profile/rev5/yaml/FedRAMP_rev5_profile.yaml
out/FedRAMP/mapping/xml/FedRAMP_NIST_SP-800-53_rev5_to_CR26_mapping-collection.xml
```

Generated OSCAL artifacts under `out/FedRAMP` are intentionally tracked so the
assembled catalog, profile shells, and mapping collection can be consumed
directly from the repository. Regenerate them after converter or configuration
changes.

## Configuration and Output Contract

The generator is driven by `cr26-oscal.config.json`. Source inputs, project
metadata, OSCAL settings, and artifact layout are all configured in the project
config.

The main configuration sections are:

- `oscal`: Target OSCAL version, XML namespace, and XML model processing
  instruction.
- `sources`: GitHub source files fetched by the generator, including the
  FedRAMP CR26 rules JSON and the NIST SP 800-53 Rev5 OSCAL catalog JSON used
  for statement expansion.
- `metadata`: Shared artifact metadata such as version, last modified date,
  keyword props, source links, roles, parties, and responsible parties.
- `metadata.*References`: External JSON files that can supply metadata props,
  links, roles, parties, and responsible-party declarations.
- `output.rootFolder`: Top-level output folder under the selected `--out`
  directory.
- `output.formats`: Catalog/profile formats. XML is generated directly; JSON
  and YAML are converted from XML using `oscal-cli`.
- `output.catalogs`: Catalog artifacts to generate, including title, scope,
  filename base, and whether KSI controls are included.
- `output.profile.profiles`: Profile shells to generate from the harmonized
  catalog, including scope and KSI inclusion rules.
- `output.mapping.mappings`: Mapping collections to generate from CR26 control
  hints, including source and target resources. Statement-level mappings use
  the configured NIST OSCAL catalog JSON source to expand control references to
  statement IDs.

The generated catalog is the source artifact. Profile shells import the
catalog, and non-XML catalog/profile files are derived from their XML
counterparts. Mapping collections are currently emitted as XML only.

## OSCAL Validation using oscal-cli (NIST)

The generator writes XML directly, then uses NIST `oscal-cli` to convert the XML
catalog and profile shells to JSON and YAML. The mapping collection is currently
XML-only because the most currently known version of `oscal-cli` does not expose
mapping conversion commands.

Validate generated OSCAL in all configured formats with NIST `oscal-cli`:

```bash
bun run validate:oscal -- --out out
```

NOTE: The validation script expects `oscal-cli` on `PATH`. Use `--oscal-cli` to
point to a specific executable.

For validations of OSCAL schema validation beyond v1.1.3, provide a local OSCAL
metaschema directory using the applicable OSCAL tag (e.g., `v1.2.1`). The validation
helper will generate XSDs from the supplied metaschemas and use `xmllint` for XML
artifacts:

Example:

```bash
mkdir -p /tmp/oscal-1.2.1
git -C /path/to/OSCAL archive --format=tar v1.2.1 src/metaschema | \
  tar -x -C /tmp/oscal-1.2.1

bun run validate:oscal -- \
  --out out \
  --metaschema-root /tmp/oscal-1.2.1/src/metaschema
```

The supplied `oscal-cli` is still used for JSON/YAML validation and XML-to-
JSON/YAML conversion.

## Repository Layout

```text
cr26-oscal.config.json
references/
  metadata-links.json
  metadata-keywords.json
  metadata-responsibility.json
src/
  cli.js               Command-line entrypoint.
  config.js            Project configuration loader.
  cr26-to-oscal.js     CR26-to-OSCAL catalog logic.
  ids.js               Deterministic UUID helpers.
  sources.js           Configured source retrieval.
  validate-oscal.js    oscal-cli validation helper.
test/
  fixtures/            Minimal CR26 fixture for tests.
out/FedRAMP/           Published generated OSCAL artifacts.
```

The source is dependency-free JavaScript and is also intended to run under a
working Node.js 20+ runtime:

```bash
node src/cli.js --out out
```

## Future

- This should probably be redone to use an XML builder like xlmbuilder2 rather
  than XML string construction.
- Improve de-duplication throughout.
- Introduce validation (current iteration assumes everything is well formed)
- Improve visibility for unmatched terms, duplicated keys (see above), and empty
  values.
