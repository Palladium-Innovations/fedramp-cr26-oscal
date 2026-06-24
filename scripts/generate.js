#!/usr/bin/env bun

process.stderr.write(`Usage:
  bun run generate:oscal -- --out out
  bun run generate:fedramp -- --ssp <path> --ap <path> --ar <path> --mapping <path> [--out-dir <dir>]

Choose one of:
  generate:oscal     Generate FedRAMP CR26 OSCAL catalog, profiles, and mapping collection.
  generate:fedramp   Generate FedRAMP-facing JSON documents from OSCAL source artifacts.
`);

process.exitCode = 1;
