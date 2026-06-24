import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { createCertificationOverviewPackage } from "../src/adapters/certification-overview-package.js";

describe("Certification Overview Package adapter", () => {
  test("fails when a projected source value is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cop-adapter-"));
    const sspPath = join(dir, "ssp.json");
    const mappingPath = join(dir, "mapping.json");

    await writeFile(
      sspPath,
      JSON.stringify({
        "system-security-plan": {
          metadata: {},
          "system-characteristics": {}
        }
      }),
      "utf8"
    );

    await writeFile(
      mappingPath,
      JSON.stringify({
        serviceIdentification: {
          website: {
            transform: "metadataLink",
            rel: "homepage"
          }
        }
      }),
      "utf8"
    );

    await expect(createCertificationOverviewPackage({ ssp: sspPath, mapping: mappingPath })).rejects.toThrow(
      "Missing required source value for serviceIdentification.website"
    );
  });

  test("fails when a projection transform is unknown", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cop-adapter-"));
    const sspPath = join(dir, "ssp.json");
    const mappingPath = join(dir, "mapping.json");

    await writeFile(
      sspPath,
      JSON.stringify({
        "system-security-plan": {
          metadata: {},
          "system-characteristics": {
            "system-name": "ACME Cloud"
          }
        }
      }),
      "utf8"
    );

    await writeFile(
      mappingPath,
      JSON.stringify({
        serviceIdentification: {
          serviceName: {
            source: "system-characteristics.system-name",
            transform: "notARealTransform"
          }
        }
      }),
      "utf8"
    );

    await expect(createCertificationOverviewPackage({ ssp: sspPath, mapping: mappingPath })).rejects.toThrow(
      "Unknown projection transform: notARealTransform"
    );
  });
});
