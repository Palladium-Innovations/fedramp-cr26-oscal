import { describe, expect, test } from "bun:test";
import { createSdr } from "../src/adapters/sdr.js";

describe("SDR adapter", () => {
  test("projects OSCAL SSP/AP/AR content into an SDR for mapped KSIs with SSP coverage", async () => {
    const sdr = await createSdr({
      ssp: "examples/acme-cloud/oscal/system-security-plan.json",
      ap: "examples/acme-cloud/oscal/assessment-plan.json",
      ar: "examples/acme-cloud/oscal/assessment-results.json",
      mapping: "out/FedRAMP/mapping/xml/FedRAMP_NIST_SP-800-53_rev5_to_CR26_mapping-collection.xml",
      certificationPackageOverviewUri: "urn:example:certification-package-overview"
    });

    const iamAam = sdr.keySecurityIndicators.find((ksi) => ksi.ksiId === "KSI-IAM-AAM");

    expect(sdr.keySecurityIndicators.map((ksi) => ksi.ksiId)).toContain("KSI-IAM-AAM");
    expect(sdr.securityControls).toHaveLength(1);
    expect(iamAam.ksiImplementation).toContain(
      "ACME Identity Service disables accounts when automated risk scoring identifies significant account compromise risk."
    );
    expect(iamAam.ksiTests).toContain("ACME.IAM.2.1v1");
    expect(iamAam.ksiEvidence).toHaveLength(2);
    expect(sdr.securityControls[0].controlId).toBe("ac-2.13");
  });
});
