#!/usr/bin/env bun

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createSdr } from "../src/adapters/sdr.js";
import { createCertificationOverviewPackage } from "../src/adapters/certification-overview-package.js";

const COP_FILE = "certification-overview-package.json";

// FedRAMP-facing documents, each: output filename + how to build it from the
// shared inputs. Register new document adapters here as they are implemented.
const DOCUMENTS = [
  {
    file: COP_FILE,
    create: (args) => createCertificationOverviewPackage({ ssp: args.ssp, mapping: args.copMapping })
  },
  {
    file: "security-decision-record.json",
    create: (args) =>
      createSdr({
        ssp: args.ssp,
        ap: args.ap,
        ar: args.ar,
        mapping: args.mapping,
        certificationPackageOverviewUri: args.cpo ?? COP_FILE
      })
  }
];

function usage() {
  return `Usage:
  generate-fedramp --ssp <path> --ap <path> --ar <path> --mapping <path> [--out-dir <dir>]

Options:
  --ssp          OSCAL system security plan JSON.
  --ap           OSCAL assessment plan JSON.
  --ar           OSCAL assessment results JSON.
  --mapping      OSCAL mapping collection XML (NIST -> CR26/KSI).
  --out-dir      Output directory for the generated FedRAMP documents. Defaults to out/acme-cloud.
  --cpo          Certification Package Overview URI recorded in the SDR. Defaults to ${COP_FILE}.
  --cop-mapping  Certification Overview Package projection rules JSON. Defaults to the bundled mapping.
  --help         Show this help.
`;
}

function parseArgs(argv) {
  const args = { outDir: "out/acme-cloud" };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--ssp") {
      args.ssp = argv[++index];
    } else if (arg === "--ap") {
      args.ap = argv[++index];
    } else if (arg === "--ar") {
      args.ar = argv[++index];
    } else if (arg === "--mapping") {
      args.mapping = argv[++index];
    } else if (arg === "--out-dir") {
      args.outDir = argv[++index];
    } else if (arg === "--cpo") {
      args.cpo = argv[++index];
    } else if (arg === "--cop-mapping") {
      args.copMapping = argv[++index];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function requireArg(args, name, flag) {
  if (!args[name]) {
    throw new Error(`Missing required argument: --${flag}`);
  }
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);

  if (args.help) {
    process.stdout.write(usage());
    return;
  }

  requireArg(args, "ssp", "ssp");
  requireArg(args, "ap", "ap");
  requireArg(args, "ar", "ar");
  requireArg(args, "mapping", "mapping");

  await mkdir(args.outDir, { recursive: true });

  for (const document of DOCUMENTS) {
    const content = await document.create(args);
    const path = join(args.outDir, document.file);
    await writeFile(path, `${JSON.stringify(content, null, 2)}\n`, "utf8");
    process.stdout.write(`Generated ${path}\n`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.stderr.write(usage());
    process.exitCode = 1;
  });
}
