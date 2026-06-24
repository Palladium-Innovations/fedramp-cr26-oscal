// Single source of truth for the OSCAL mapping-collection <map> element.
// mapEntryXml (writer, used by cr26-to-oscal.js) and readMapEntries (reader,
// used by adapters/sdr.js) are inverses — change them together.

function escapeXml(value) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function attributes(fragment) {
  return Object.fromEntries(
    [...fragment.matchAll(/([A-Za-z0-9_-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value])
  );
}

export function mapEntryXml({ uuid, relationship, sourceItemType, targetItemType, sourceIds, targetId }) {
  return `    <map uuid="${escapeXml(uuid)}">
      <relationship>${escapeXml(relationship)}</relationship>
${sourceIds.map((sourceId) => `      <source type="${escapeXml(sourceItemType)}" id-ref="${escapeXml(sourceId)}"/>`).join("\n")}
      <target type="${escapeXml(targetItemType)}" id-ref="${escapeXml(targetId)}"/>
    </map>`;
}

export function readMapEntries(xml) {
  return [...xml.matchAll(/<map\b[^>]*>([\s\S]*?)<\/map>/g)].map(([, body]) => ({
    relationship: body.match(/<relationship>([^<]+)<\/relationship>/)?.[1],
    sources: [...body.matchAll(/<source\b([^/]*)\/>/g)].map((match) => attributes(match[1])),
    target: attributes(body.match(/<target\b([^/]*)\/>/)?.[1] ?? "")
  }));
}

export function readKsiMappings(xml) {
  const mappingsByKsi = new Map();

  for (const { relationship, sources, target } of readMapEntries(xml)) {
    if (relationship !== "superset-of") {
      continue;
    }

    const ksiId = target["id-ref"]?.replace(/_smt(?:\..*)?$/, "");

    if (!ksiId?.startsWith("KSI-")) {
      continue;
    }

    const mapping = mappingsByKsi.get(ksiId) ?? {
      controlIds: new Set(),
      statementIds: new Set()
    };

    for (const source of sources) {
      if (source.type === "control") {
        mapping.controlIds.add(source["id-ref"]);
      } else if (source.type === "statement") {
        mapping.statementIds.add(source["id-ref"]);
      }
    }

    mappingsByKsi.set(ksiId, mapping);
  }

  return new Map(
    [...mappingsByKsi].map(([ksiId, mapping]) => [
      ksiId,
      {
        controlIds: [...mapping.controlIds],
        statementIds: [...mapping.statementIds]
      }
    ])
  );
}
