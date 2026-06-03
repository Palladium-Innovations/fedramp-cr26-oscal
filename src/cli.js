#!/usr/bin/env bun

import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { loadConfig } from "./config.js";
import { loadConfiguredSources } from "./sources.js";
import {
  createCatalogOutputs,
  createMappingOutputs,
  createProfileOutputs,
  convertedCatalogOutputs,
  convertedProfileOutputs
} from "./cr26-to-oscal.js";

function usage() {
  return `Usage:
  cr26-oscal [--out <directory>]

Options:
  --out, -o      Output directory for generated OSCAL artifacts.
  --oscal-cli    Path to oscal-cli executable. Defaults to oscal-cli on PATH.
  --help, -h     Show this help.
`;
}

function parseArgs(argv) {
  const args = {
    out: "out",
    oscalCli: "oscal-cli"
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--out" || arg === "-o") {
      args.out = argv[++index];
    } else if (arg === "--oscal-cli") {
      args.oscalCli = argv[++index];
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

  // Output any stdout or stderr from the command, and throw an error if it failed
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

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);

  if (args.help) {
    process.stdout.write(usage());
    return;
  }

  const config = await loadConfig();
  const { cr26Rules: rules, nistCatalog } = await loadConfiguredSources(config);
  const catalogOutputs = createCatalogOutputs(rules, config);
  const profileOutputs = createProfileOutputs(rules, config);
  const mappingOutputs = createMappingOutputs(rules, config, { nistCatalog });

  // catalog 
  for (const output of catalogOutputs) {
    const outputPath = join(args.out, ...output.path);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, output.xml, "utf8");

    for (const convertedOutput of convertedCatalogOutputs(config, output.catalog)) {
      const convertedPath = join(args.out, ...convertedOutput.path);
      await mkdir(dirname(convertedPath), { recursive: true });
      run(args.oscalCli, [
        "catalog",
        "convert",
        "--overwrite",
        `--to=${convertedOutput.format.id}`,
        outputPath,
        convertedPath
      ]);
    }
  }

  // profile
  for (const output of profileOutputs) {
    const outputPath = join(args.out, ...output.path);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, output.xml, "utf8");

    for (const convertedOutput of convertedProfileOutputs(config, output.profile)) {
      const convertedPath = join(args.out, ...convertedOutput.path);
      await mkdir(dirname(convertedPath), { recursive: true });
      run(args.oscalCli, [
        "profile",
        "convert",
        "--overwrite",
        `--to=${convertedOutput.format.id}`,
        outputPath,
        convertedPath
      ]);
    }
  }

  // mapping-collection
  for (const output of mappingOutputs) {
    const outputPath = join(args.out, ...output.path);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, output.xml, "utf8");
  }

  process.stdout.write(`Generated OSCAL artifacts in ${args.out}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.stderr.write(usage());
    process.exitCode = 1;
  });
}
