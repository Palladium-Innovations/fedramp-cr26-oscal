#!/usr/bin/env bun

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { spawnSync } from "node:child_process";
import { loadConfig } from "./config.js";
import {
  catalogOutputFormats,
  catalogOutputPath,
  mappingOutputFormats,
  mappingOutputPath,
  profileOutputPath
} from "./cr26-to-oscal.js";

function usage() {
  return `Usage:
  validate-oscal [--out <generated-oscal-directory>]

Options:
  --out, -o       Directory containing generated OSCAL artifacts. Defaults to out.
  --oscal-cli     Path to oscal-cli executable. Defaults to oscal-cli on PATH.
  --metaschema-root
                  Path to OSCAL src/metaschema. When provided, XML files are
                  validated against generated XSDs from these metaschemas.
  --xmllint       Path to xmllint executable. Defaults to xmllint on PATH.
  --help, -h      Show this help.
`;
}

function parseArgs(argv) {
  const args = {
    out: "out",
    oscalCli: "oscal-cli",
    metaschemaRoot: process.env.OSCAL_METASCHEMA_ROOT,
    xmllint: "xmllint"
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--out" || arg === "-o") {
      args.out = argv[++index];
    } else if (arg === "--oscal-cli") {
      args.oscalCli = argv[++index];
    } else if (arg === "--metaschema-root") {
      args.metaschemaRoot = argv[++index];
    } else if (arg === "--xmllint") {
      args.xmllint = argv[++index];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }

  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")}`);
  }
}

function metaschemaFilename(kind) {
  if (kind === "catalog") {
    return "oscal_catalog_metaschema.xml";
  }

  if (kind === "profile") {
    return "oscal_profile_metaschema.xml";
  }

  if (kind === "mapping") {
    return "oscal_mapping_metaschema.xml";
  }

  throw new Error(`Unsupported OSCAL kind: ${kind}`);
}

async function createSchemaCache(args) {
  if (!args.metaschemaRoot) {
    return undefined;
  }

  return {
    directory: await mkdtemp(join(tmpdir(), "cr26-oscal-schema-")),
    schemasByKind: new Map()
  };
}

function generateXmlSchema(args, cache, kind) {
  const cached = cache.schemasByKind.get(kind);

  if (cached) {
    return cached;
  }

  const metaschemaPath = join(args.metaschemaRoot, metaschemaFilename(kind));
  const schemaPath = join(cache.directory, `${kind}.xsd`);
  run(args.oscalCli, ["metaschema", "generate-schema", "--overwrite", "--as=xml", metaschemaPath, schemaPath]);
  cache.schemasByKind.set(kind, schemaPath);
  return schemaPath;
}

function validateArtifact(args, cache, artifact) {
  const { kind, format, path } = artifact;

  if (cache && format.id === "xml") {
    const schemaPath = generateXmlSchema(args, cache, kind);
    run(args.xmllint, ["--noout", "--schema", schemaPath, path]);
    return;
  }

  if (kind === "mapping") {
    process.stdout.write(`Skipping ${basename(path)}; provide --metaschema-root to validate mapping artifacts.\n`);
    return;
  }

  run(args.oscalCli, [kind, "validate", `--as=${format.id}`, path]);
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);

  if (args.help) {
    process.stdout.write(usage());
    return;
  }

  const config = await loadConfig();
  const schemaCache = await createSchemaCache(args);

  try {
    for (const catalog of config.output.catalogs) {
      for (const format of catalogOutputFormats(config)) {
        const path = join(args.out, ...catalogOutputPath(config, catalog, format));
        process.stdout.write(`Validating ${basename(path)}\n`);
        validateArtifact(args, schemaCache, { kind: "catalog", format, path });
      }
    }

    for (const profile of config.output.profile?.profiles ?? []) {
      for (const format of catalogOutputFormats(config)) {
        const path = join(args.out, ...profileOutputPath(config, profile, format));
        process.stdout.write(`Validating ${basename(path)}\n`);
        validateArtifact(args, schemaCache, { kind: "profile", format, path });
      }
    }

    for (const mapping of config.output.mapping?.mappings ?? []) {
      for (const format of mappingOutputFormats(config)) {
        const path = join(args.out, ...mappingOutputPath(config, mapping, format));
        process.stdout.write(`Validating ${basename(path)}\n`);
        validateArtifact(args, schemaCache, { kind: "mapping", format, path });
      }
    }
  } finally {
    if (schemaCache) {
      await rm(schemaCache.directory, { recursive: true, force: true });
    }
  }

  process.stdout.write("OSCAL validation passed.\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.stderr.write(usage());
    process.exitCode = 1;
  });
}
