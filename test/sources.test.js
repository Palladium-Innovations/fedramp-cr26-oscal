import assert from "node:assert/strict";
import test from "node:test";
import { fetchJsonSource, loadConfiguredSources, sourceUrl } from "../src/sources.js";

const cr26Source = {
  type: "github-raw",
  owner: "FedRAMP",
  repo: "rules",
  ref: "main",
  path: "fedramp-consolidated-rules.json"
};

const nistSource = {
  type: "github-raw",
  owner: "usnistgov",
  repo: "oscal-content",
  ref: "v1.4.0",
  path: "nist.gov/SP800-53/rev5/json/NIST_SP-800-53_rev5_catalog.json"
};

test("builds GitHub raw source URLs", () => {
  assert.equal(
    sourceUrl(cr26Source),
    "https://raw.githubusercontent.com/FedRAMP/rules/main/fedramp-consolidated-rules.json"
  );
});

test("fetches configured JSON sources", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);

    return {
      ok: true,
      status: 200,
      statusText: "OK",
      async text() {
        return JSON.stringify({ url });
      }
    };
  };

  const sources = await loadConfiguredSources(
    {
      sources: {
        cr26Rules: cr26Source,
        nistRev5CatalogJson: nistSource
      }
    },
    { fetchImpl }
  );

  assert.equal(
    sources.cr26Rules.url,
    "https://raw.githubusercontent.com/FedRAMP/rules/main/fedramp-consolidated-rules.json"
  );
  assert.equal(
    sources.nistCatalog.url,
    "https://raw.githubusercontent.com/usnistgov/oscal-content/v1.4.0/nist.gov/SP800-53/rev5/json/NIST_SP-800-53_rev5_catalog.json"
  );
  assert.deepEqual(calls, [sources.cr26Rules.url, sources.nistCatalog.url]);
});

test("reports source fetch failures", async () => {
  await assert.rejects(
    fetchJsonSource(
      {
        id: "example",
        ...cr26Source
      },
      {
        fetchImpl: async () => ({
          ok: false,
          status: 404,
          statusText: "Not Found"
        })
      }
    ),
    /Failed to fetch source 'example': HTTP 404 Not Found/
  );
});
