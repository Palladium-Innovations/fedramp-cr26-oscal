import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadConfig } from "../src/config.js";
import { createCatalogOutputs, createMappingOutputs, createProfileOutputs } from "../src/cr26-to-oscal.js";

async function fixture() {
  return JSON.parse(await readFile(new URL("./fixtures/cr26-minimal.json", import.meta.url), "utf8"));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function palladiumPartyRegex() {
  return /<party type="organization" uuid="([^"]+)">\n      <name>Palladium Innovations, LLC<\/name>\n      <email-address>oscal@go-palladium\.com<\/email-address>\n      <address>\n        <addr-line>341 Angela Lane<\/addr-line>\n        <city>Mary Esther<\/city>\n        <state>FL<\/state>\n        <postal-code>32569<\/postal-code>\n      <\/address>\n    <\/party>/;
}

test("creates a harmonized FedRAMP CR26 XML catalog with CR26 groups and references", async () => {
  const config = await loadConfig();
  const outputs = createCatalogOutputs(await fixture(), config);
  const keywords = config.metadata.props.find((prop) => prop.name === "keywords");
  const sourceLink = config.metadata.links.find((link) => link.rel === "source");
  const palladiumParty = config.metadata.parties.find((party) => party.id === "palladium");
  const [catalog] = outputs;

  assert.ok(keywords);
  assert.ok(sourceLink);
  assert.ok(palladiumParty);

  assert.deepEqual(
    outputs.map((output) => output.path.join("/")),
    ["FedRAMP/catalog/xml/FedRAMP_CR26_catalog.xml"]
  );

  for (const output of outputs) {
    assert.match(
      output.xml,
      /^<\?xml version="1.0" encoding="UTF-8"\?><\?xml-model schematypens="http:\/\/www\.w3\.org\/2001\/XMLSchema" type="application\/xml" href="https:\/\/github\.com\/usnistgov\/OSCAL\/releases\/download\/v1\.2\.1\/oscal_complete_schema\.xsd"\?><catalog/
    );
    assert.match(output.xml, /<catalog xmlns="http:\/\/csrc\.nist\.gov\/ns\/oscal\/1\.0" uuid="[^"]+">/);
    assert.match(output.xml, /<metadata>/);
    assert.match(output.xml, new RegExp(`<last-modified>${config.metadata.lastModified}</last-modified>`));
    assert.match(output.xml, new RegExp(`<version>${config.metadata.version}</version>`));
    assert.match(output.xml, new RegExp(`<oscal-version>${config.oscal.version}</oscal-version>`));
    assert.match(output.xml, /<revisions>\n      <revision>/);
    assert.match(output.xml, /<link rel="version-history" href="#[^"]+"\/>/);
    assert.match(output.xml, /<\/revisions>\n    <prop name="keywords" value="/);
    assert.ok(output.xml.includes(`<prop name="keywords" value="${keywords.value}"/>`));
    const sourceLinkMatch = output.xml.match(/<link rel="source" href="#([^"]+)"\/>/);
    assert.ok(sourceLinkMatch);
    assert.match(
      output.xml,
      /<role id="creator">\n      <title>Unofficial OSCAL Catalog Creator<\/title>\n    <\/role>/
    );
    assert.match(
      output.xml,
      /<role id="publisher">\n      <title>Unofficial OSCAL Catalog Publisher<\/title>\n    <\/role>/
    );
    assert.match(output.xml, /<role id="contact">\n      <title>Project Contact<\/title>\n    <\/role>/);
    const partyMatch = output.xml.match(palladiumPartyRegex());
    assert.ok(partyMatch);
    for (const roleId of ["creator", "publisher", "contact"]) {
      assert.match(
        output.xml,
        new RegExp(
          `<responsible-party role-id="${roleId}">\\n      <party-uuid>${escapeRegExp(
            partyMatch[1]
          )}</party-uuid>\\n    </responsible-party>`
        )
      );
    }
    assert.match(output.xml, /<back-matter>/);
    assert.match(output.xml, /<resource uuid="[^"]+">\n      <title>fedramp-cr26-oscal 0.1.0 release history<\/title>/);
    assert.match(output.xml, /<rlink href="urn:palladium:fedramp-cr26-oscal:version-history:0.1.0"\/>/);
    assert.match(
      output.xml,
      new RegExp(
        `<resource uuid="${escapeRegExp(sourceLinkMatch[1])}">\\n      <title>${escapeRegExp(
          sourceLink.resource.title
        )}</title>\\n      <rlink media-type="${escapeRegExp(sourceLink.resource.mediaType)}" href="${escapeRegExp(
          sourceLink.resource.href
        )}"/>`
      )
    );
    assert.doesNotMatch(output.xml, /<remarks\b/);
    assert.match(output.xml, /<group class="collection" id="FRR">/);
    assert.match(output.xml, /<group class="rule-area" id="VDR">/);
    assert.match(output.xml, /<part name="overview">\n      <p>Manage vulnerabilities\.<\/p>\n    <\/part>/);
    assert.match(output.xml, /<group class="section" id="VDR-CSO">/);
    assert.match(output.xml, /<control class="frr" id="VDR-CSO-DET">/);
    assert.match(output.xml, /<part id="VDR-CSO-DET_smt" name="statement">\n        <p>Providers MUST detect vulnerabilities\.<\/p>\n      <\/part>/);
    assert.match(
      output.xml,
      /<link rel="definition" href="#[^"]+">\n        <text>Cloud Service Provider<\/text>\n      <\/link>/
    );
    assert.match(output.xml, /<title>Definition: Cloud Service Provider<\/title>/);
    const definitionResourceMatch = output.xml.match(
      /<resource uuid="[^"]+">\n      <title>Definition: Cloud Service Provider<\/title>([\s\S]*?)\n    <\/resource>/
    );
    assert.ok(definitionResourceMatch);
    assert.doesNotMatch(definitionResourceMatch[1], /<description>/);
    assert.match(
      definitionResourceMatch[1],
      new RegExp(
        `<base64 filename="FRD-CSP\\.txt" media-type="text/plain">${Buffer.from(
          "A provider of a cloud service offering.\n\nAlso known as: Provider",
          "utf8"
        ).toString("base64")}</base64>`
      )
    );
  }

  assert.match(catalog.xml, /<group class="section" id="VDR-AGM">/);
  assert.match(catalog.xml, /<control class="frr" id="VDR-AGM-RVR">/);
  assert.match(catalog.xml, /<control class="frr" id="VDR-AGM-ATO">/);
  assert.match(catalog.xml, /<group class="collection" id="KSI">/);
  assert.match(catalog.xml, /<control class="ksi" id="KSI-IAM-AAM">/);
});

test("supports current CR26 all scope and subset metadata", async () => {
  const config = await loadConfig();
  const rules = await fixture();
  const ruleSet = rules.FRR.VDR;

  ruleSet.data.all = ruleSet.data.both;
  delete ruleSet.data.both;
  ruleSet.info.subsets = ruleSet.info.labels;
  delete ruleSet.info.labels;

  const [catalog] = createCatalogOutputs(rules, config);
  const profiles = createProfileOutputs(rules, config);
  const [mapping] = createMappingOutputs(rules, config);
  const profile20x = profiles.find((output) => output.profile.id === "20x");
  const importBody = profile20x.xml.match(/<import href="#([^"]+)">\n([\s\S]*?)\n  <\/import>/)[2];
  const includedIds = [...importBody.matchAll(/<with-id>([^<]+)<\/with-id>/g)].map((match) => match[1]);

  assert.match(
    catalog.xml,
    /<group class="section" id="VDR-CSO">\n      <title>General Provider Responsibilities<\/title>/
  );
  assert.match(catalog.xml, /<control class="frr" id="VDR-CSO-DET">/);
  assert.ok(includedIds.includes("VDR-CSO-DET"));
  assert.match(mapping.xml, /<source type="control" id-ref="VDR-CSO-DET"\/>/);
});

test("creates FedRAMP 20x and Rev5 profile shells from the harmonized catalog", async () => {
  const config = await loadConfig();
  const outputs = createProfileOutputs(await fixture(), config);
  const palladiumParty = config.metadata.parties.find((party) => party.id === "palladium");

  assert.ok(palladiumParty);
  assert.deepEqual(
    outputs.map((output) => output.path.join("/")),
    [
      "FedRAMP/profile/20x/xml/FedRAMP_20x_profile.xml",
      "FedRAMP/profile/rev5/xml/FedRAMP_rev5_profile.xml"
    ]
  );

  for (const output of outputs) {
    assert.match(
      output.xml,
      /^<\?xml version="1.0" encoding="UTF-8"\?><\?xml-model schematypens="http:\/\/www\.w3\.org\/2001\/XMLSchema" type="application\/xml" href="https:\/\/github\.com\/usnistgov\/OSCAL\/releases\/download\/v1\.2\.1\/oscal_complete_schema\.xsd"\?><profile/
    );
    assert.match(output.xml, /<profile xmlns="http:\/\/csrc\.nist\.gov\/ns\/oscal\/1\.0" uuid="[^"]+">/);
    assert.match(output.xml, /<metadata>/);
    assert.match(output.xml, new RegExp(`<last-modified>${config.metadata.lastModified}</last-modified>`));
    assert.match(output.xml, new RegExp(`<version>${config.metadata.version}</version>`));
    assert.match(output.xml, new RegExp(`<oscal-version>${config.oscal.version}</oscal-version>`));
    assert.doesNotMatch(output.xml, /<revisions>/);
    assert.doesNotMatch(output.xml, /<prop\b/);
    assert.doesNotMatch(output.xml, /<link rel="source"/);
    assert.match(output.xml, /<role id="creator">\n      <title>Unofficial OSCAL Profile Creator<\/title>\n    <\/role>/);
    assert.match(output.xml, /<role id="publisher">\n      <title>Unofficial OSCAL Profile Publisher<\/title>\n    <\/role>/);
    const partyMatch = output.xml.match(palladiumPartyRegex());
    assert.ok(partyMatch);
    for (const roleId of ["creator", "publisher", "contact"]) {
      assert.match(
        output.xml,
        new RegExp(
          `<responsible-party role-id="${roleId}">\\n      <party-uuid>${escapeRegExp(
            partyMatch[1]
          )}</party-uuid>\\n    </responsible-party>`
        )
      );
    }
    const importMatch = output.xml.match(/<import href="#([^"]+)">\n([\s\S]*?)\n  <\/import>/);
    assert.ok(importMatch);
    const importBody = importMatch[2];
    const includedIds = [...importBody.matchAll(/<with-id>([^<]+)<\/with-id>/g)].map((match) => match[1]);
    assert.doesNotMatch(importBody, /<include-all\/>/);
    assert.match(importBody, /<include-controls>/);
    assert.match(importBody, /<\/include-controls>/);

    if (output.profile.id === "20x") {
      assert.deepEqual(includedIds, ["VDR-CSO-DET", "VDR-AGM-RVR", "KSI-IAM-AAM"]);
    } else if (output.profile.id === "rev5") {
      assert.deepEqual(includedIds, ["VDR-CSO-DET", "VDR-AGM-ATO"]);
    } else {
      assert.fail(`Unexpected profile id: ${output.profile.id}`);
    }

    assert.match(output.xml, /<merge>\n    <as-is>true<\/as-is>\n  <\/merge>/);
    assert.match(
      output.xml,
      new RegExp(
        `<resource uuid="${escapeRegExp(importMatch[1])}">\\n      <description>\\n        <p>FedRAMP Consolidated Rules for 2026 - Unofficial OSCAL Catalog</p>\\n      </description>`
      )
    );
    assert.match(
      output.xml,
      /<rlink media-type="application\/oscal\.catalog\+xml" href="..\/..\/..\/catalog\/xml\/FedRAMP_CR26_catalog\.xml"\/>/
    );
    assert.match(
      output.xml,
      /<rlink media-type="application\/oscal\.catalog\+json" href="..\/..\/..\/catalog\/json\/FedRAMP_CR26_catalog\.json"\/>/
    );
    assert.match(
      output.xml,
      /<rlink media-type="application\/oscal\.catalog\+yaml" href="..\/..\/..\/catalog\/yaml\/FedRAMP_CR26_catalog\.yaml"\/>/
    );
  }

  assert.match(outputs[0].xml, /<title>FedRAMP 20x Consolidated Rules for 2026 - Unofficial OSCAL Profile<\/title>/);
  assert.match(outputs[1].xml, /<title>FedRAMP Rev5 Consolidated Rules for 2026 - Unofficial OSCAL Profile<\/title>/);
});

test("creates a CR26 to SP 800-53 Rev5 mapping collection from source control hints", async () => {
  const config = await loadConfig();
  const outputs = createMappingOutputs(await fixture(), config);
  const [output] = outputs;

  assert.deepEqual(
    outputs.map((mappingOutput) => mappingOutput.path.join("/")),
    ["FedRAMP/mapping/xml/FedRAMP_CR26_to_NIST_SP-800-53_rev5_mapping-collection.xml"]
  );

  assert.match(
    output.xml,
    /^<\?xml version="1.0" encoding="UTF-8"\?><\?xml-model schematypens="http:\/\/www\.w3\.org\/2001\/XMLSchema" type="application\/xml" href="https:\/\/github\.com\/usnistgov\/OSCAL\/releases\/download\/v1\.2\.1\/oscal_complete_schema\.xsd"\?><mapping-collection/
  );
  assert.match(output.xml, /<mapping-collection xmlns="http:\/\/csrc\.nist\.gov\/ns\/oscal\/1\.0" uuid="[^"]+">/);
  assert.match(
    output.xml,
    /<title>FedRAMP CR26 to NIST SP 800-53 Rev5 - Unofficial OSCAL Mapping Collection<\/title>/
  );
  assert.match(output.xml, new RegExp(`<oscal-version>${config.oscal.version}</oscal-version>`));
  assert.match(output.xml, /<role id="creator">\n      <title>Unofficial OSCAL Mapping Creator<\/title>\n    <\/role>/);
  assert.match(output.xml, /<role id="publisher">\n      <title>Unofficial OSCAL Mapping Publisher<\/title>\n    <\/role>/);
  assert.match(output.xml, palladiumPartyRegex());
  assert.match(
    output.xml,
    /<provenance method="automation" matching-rationale="semantic" status="draft">\n    <mapping-description>\n      <p>Initial machine-derived mapping from CR26 source control references to NIST SP 800-53 Rev5 controls\. Relationships require human review\.<\/p>\n    <\/mapping-description>\n  <\/provenance>/
  );
  assert.match(
    output.xml,
    /<mapping uuid="[^"]+" method="automation" matching-rationale="semantic" status="draft">/
  );
  assert.match(
    output.xml,
    /<source-resource type="catalog" href="..\/..\/catalog\/xml\/FedRAMP_CR26_catalog\.xml"\/>/
  );
  assert.match(
    output.xml,
    /<target-resource type="catalog" href="https:\/\/raw\.githubusercontent\.com\/usnistgov\/oscal-content\/v1\.4\.0\/src\/nist\.gov\/SP800-53\/rev5\/xml\/NIST_SP-800-53_rev5_catalog\.xml"\/>/
  );
  assert.match(
    output.xml,
    /<map uuid="[^"]+">\n      <relationship>intersects-with<\/relationship>\n      <source type="control" id-ref="VDR-CSO-DET"\/>\n      <target type="control" id-ref="ra-5"\/>\n    <\/map>/
  );
  assert.match(
    output.xml,
    /<map uuid="[^"]+">\n      <relationship>intersects-with<\/relationship>\n      <source type="control" id-ref="KSI-IAM-AAM"\/>\n      <target type="control" id-ref="ac-2\.2"\/>\n    <\/map>/
  );
  assert.doesNotMatch(output.xml, /<source type="control" id-ref="VDR-AGM-RVR"\/>/);
});
