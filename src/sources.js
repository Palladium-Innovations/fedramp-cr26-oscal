function requiredString(source, key) {
  const value = source?.[key];

  if (!value || typeof value !== "string") {
    throw new Error(`Source must provide '${key}'.`);
  }

  return value;
}

function encodePath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

export function sourceUrl(source) {
  if (source?.type !== "github-raw") {
    throw new Error(`Unsupported source type: ${source?.type ?? "missing"}.`);
  }

  const owner = requiredString(source, "owner");
  const repo = requiredString(source, "repo");
  const ref = requiredString(source, "ref");
  const path = requiredString(source, "path");

  return `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(
    ref
  )}/${encodePath(path)}`;
}

export async function fetchJsonSource(source, { fetchImpl = fetch } = {}) {
  const url = sourceUrl(source);
  const response = await fetchImpl(url, {
    headers: {
      accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch source '${source.id ?? url}': HTTP ${response.status} ${response.statusText}`);
  }

  try {
    return JSON.parse(await response.text());
  } catch (error) {
    throw new Error(`Failed to parse source '${source.id ?? url}' as JSON: ${error.message}`);
  }
}

export async function loadConfiguredSources(config, options = {}) {
  const cr26Source = config.sources?.cr26Rules;
  const nistSource = config.sources?.nistRev5CatalogJson;

  if (!cr26Source) {
    throw new Error("Missing required source configuration: sources.cr26Rules.");
  }

  if (!nistSource) {
    throw new Error("Missing required source configuration: sources.nistRev5CatalogJson.");
  }

  return {
    cr26Rules: await fetchJsonSource({ id: "sources.cr26Rules", ...cr26Source }, options),
    nistCatalog: await fetchJsonSource({ id: "sources.nistRev5CatalogJson", ...nistSource }, options)
  };
}
