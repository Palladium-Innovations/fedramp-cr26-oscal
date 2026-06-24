import { deterministicUuid } from "./ids.js";
import { mapEntryXml } from "./mapping/collection.js";

const MEDIA_TYPE_TEXT_PLAIN = "text/plain";
const MEDIA_TYPE_TEXT_HTML = "text/html";
const OSCAL_CATALOG_MEDIA_TYPE_PREFIX = "application/oscal.catalog+";

function escapeXml(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function normalizeLookupValue(value) {
  return String(value).trim().toLowerCase();
}

function versionHistoryUuid(catalog, revision) {
  return deterministicUuid(`version-history:${catalog.id}:${revision.version}:${revision.versionHistory.href}`);
}

function metadataLinkUuid(link) {
  return deterministicUuid(`metadata-link:${link.rel}:${link.resource.href}`);
}

function partyUuid(party) {
  return party.uuid ?? deterministicUuid(`party:${party.id}`);
}

function definitionUuid(definitionId) {
  return deterministicUuid(`definition:${definitionId}`);
}

function referenceUuid(reference) {
  return deterministicUuid(`reference:${reference.reference ?? ""}:${reference.reference_url}`);
}

function profileUuid(profile) {
  return deterministicUuid(`profile:${profile.version}:${profile.id}`);
}

function profileCatalogResourceUuid(profile, catalog) {
  return deterministicUuid(`profile-catalog-resource:${profile.id}:${catalog.id}:${profile.version}`);
}

function mappingCollectionUuid(mapping) {
  return deterministicUuid(`mapping-collection:${mapping.version}:${mapping.id}`);
}

function mappingUuid(mapping) {
  return deterministicUuid(`mapping:${mapping.version}:${mapping.id}`);
}

function mapUuid(mapping, entry) {
  const sourceItemType = entry.sourceItemType ?? "control";
  const targetItemType = entry.targetItemType ?? "control";
  const typePrefix =
    sourceItemType === "control" && targetItemType === "control" ? "" : `${sourceItemType}:${targetItemType}:`;

  return deterministicUuid(
    `map:${mapping.id}:${typePrefix}${entry.sourceIds.join(",")}:${entry.targetId}:${mapping.relationship}`
  );
}

function catalogScopes(catalog) {
  return catalog.scopes ?? ["both"];
}

function dataForScope(ruleSet, scope) {
  if (ruleSet.data?.[scope]) {
    return ruleSet.data[scope];
  }

  if (scope === "both" && ruleSet.data?.all) {
    return ruleSet.data.all;
  }

  if (scope === "all" && ruleSet.data?.both) {
    return ruleSet.data.both;
  }

  return {};
}

function subsetInfoForScope(ruleSet, scope, label) {
  return ruleSet.info?.[scope]?.subsets?.[label] ?? ruleSet.info?.[scope]?.labels?.[label];
}

function findLabelInfo(ruleSet, label, scopes) {
  return (
    ruleSet.info.subsets?.[label] ??
    ruleSet.info.labels?.[label] ??
    scopes.map((scope) => subsetInfoForScope(ruleSet, scope, label)).find(Boolean) ??
    { name: label }
  );
}

function includesKsi(catalog) {
  return catalog.includeKsi ?? false;
}

function uniqueStrings(values) {
  const seen = new Set();
  const unique = [];

  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      unique.push(value);
    }
  }

  return unique;
}

function frrControlIds(rules, scopes) {
  const ids = [];

  for (const ruleSet of Object.values(rules.FRR ?? {})) {
    for (const scope of scopes) {
      for (const controls of Object.values(dataForScope(ruleSet, scope))) {
        ids.push(...Object.keys(controls));
      }
    }
  }

  return ids;
}

function ksiControlIds(rules) {
  return Object.values(rules.KSI ?? {}).flatMap((theme) => Object.keys(theme.indicators ?? {}));
}

function profileControlIds(rules, profile) {
  return uniqueStrings([
    ...frrControlIds(rules, catalogScopes(profile)),
    ...(includesKsi(profile) ? ksiControlIds(rules) : [])
  ]);
}

function nistControlIds(item) {
  return uniqueStrings(item.controls ?? []).filter(Boolean);
}

function collectStatementLeafIds(part) {
  const childItems = (part.parts ?? []).filter((child) => child.name === "item");

  if (childItems.length === 0) {
    return part.id ? [part.id] : [];
  }

  return childItems.flatMap(collectStatementLeafIds);
}

function nistControlStatementIds(control) {
  return uniqueStrings(
    (control.parts ?? [])
      .filter((part) => part.name === "statement")
      .flatMap(collectStatementLeafIds)
      .filter(Boolean)
  );
}

function indexNistControlStatements(control, index) {
  if (control.id) {
    index.set(control.id, nistControlStatementIds(control));
  }

  for (const child of control.controls ?? []) {
    indexNistControlStatements(child, index);
  }
}

function indexNistGroupStatements(group, index) {
  for (const control of group.controls ?? []) {
    indexNistControlStatements(control, index);
  }

  for (const child of group.groups ?? []) {
    indexNistGroupStatements(child, index);
  }
}

export function createNistStatementIndex(nistCatalog) {
  const catalog = nistCatalog?.catalog ?? nistCatalog;
  const index = new Map();

  for (const group of catalog?.groups ?? []) {
    indexNistGroupStatements(group, index);
  }

  return index;
}

function nistStatementIds(item, nistStatementIndex) {
  return uniqueStrings(nistControlIds(item).flatMap((controlId) => nistStatementIndex.get(controlId) ?? []));
}

function statementMappingEntry(cr26Id, item, nistStatementIndex) {
  if (!item.statement) {
    return undefined;
  }

  const sourceIds = nistStatementIds(item, nistStatementIndex);

  if (sourceIds.length === 0) {
    return undefined;
  }

  return {
    sourceIds,
    sourceItemType: "statement",
    targetId: `${cr26Id}_smt`,
    targetItemType: "statement"
  };
}

function frrControlMappingEntries(rules, mapping) {
  const entries = [];

  for (const ruleSet of Object.values(rules.FRR ?? {})) {
    for (const scope of catalogScopes(mapping)) {
      for (const controls of Object.values(dataForScope(ruleSet, scope))) {
        for (const [cr26Id, item] of Object.entries(controls)) {
          const sourceIds = nistControlIds(item);

          if (sourceIds.length > 0) {
            entries.push({
              sourceIds,
              sourceItemType: "control",
              targetId: cr26Id,
              targetItemType: "control"
            });
          }
        }
      }
    }
  }

  return entries;
}

function ksiControlMappingEntries(rules) {
  const entries = [];

  for (const theme of Object.values(rules.KSI ?? {})) {
    for (const [cr26Id, item] of Object.entries(theme.indicators ?? {})) {
      const sourceIds = nistControlIds(item);

      if (sourceIds.length > 0) {
        entries.push({
          sourceIds,
          sourceItemType: "control",
          targetId: cr26Id,
          targetItemType: "control"
        });
      }
    }
  }

  return entries;
}

function frrStatementMappingEntries(rules, mapping, nistStatementIndex) {
  const entries = [];

  for (const ruleSet of Object.values(rules.FRR ?? {})) {
    for (const scope of catalogScopes(mapping)) {
      for (const controls of Object.values(dataForScope(ruleSet, scope))) {
        for (const [cr26Id, item] of Object.entries(controls)) {
          const entry = statementMappingEntry(cr26Id, item, nistStatementIndex);

          if (entry) {
            entries.push(entry);
          }
        }
      }
    }
  }

  return entries;
}

function ksiStatementMappingEntries(rules, nistStatementIndex) {
  const entries = [];

  for (const theme of Object.values(rules.KSI ?? {})) {
    for (const [cr26Id, item] of Object.entries(theme.indicators ?? {})) {
      const entry = statementMappingEntry(cr26Id, item, nistStatementIndex);

      if (entry) {
        entries.push(entry);
      }
    }
  }

  return entries;
}

function artifactRequirementPartId(controlId, scope, index, { classKey } = {}) {
  return [controlId, "artifact", classKey, scope, index + 1].filter(Boolean).join("_");
}

function artifactRequirementClassName(scope, { classKey } = {}) {
  return ["artifact", classKey ? `class-${classKey}` : undefined, `scope-${scope}`].filter(Boolean).join("-");
}

function defaultArtifactRequirementPartId(kind, index) {
  return `${kind}_default_artifact_${index + 1}`;
}

function artifactValues(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (Array.isArray(value?.all_classes)) {
    return value.all_classes;
  }

  return [];
}

function statementMappingEntries(rules, mapping, context) {
  const nistStatementIndex = context?.nistStatementIndex;

  if (!nistStatementIndex) {
    throw new Error(`Mapping '${mapping.id}' requires a NIST OSCAL catalog JSON input for statement granularity.`);
  }

  return [
    ...frrStatementMappingEntries(rules, mapping, nistStatementIndex),
    ...(includesKsi(mapping) ? ksiStatementMappingEntries(rules, nistStatementIndex) : [])
  ];
}

function controlMappingEntries(rules, mapping) {
  return [
    ...frrControlMappingEntries(rules, mapping),
    ...(includesKsi(mapping) ? ksiControlMappingEntries(rules) : [])
  ];
}

function mappingEntries(rules, mapping, context) {
  const entries = [];

  if (mapping.granularities.includes("control")) {
    entries.push(...controlMappingEntries(rules, mapping));
  }

  if (mapping.granularities.includes("statement")) {
    entries.push(...statementMappingEntries(rules, mapping, context));
  }

  return entries;
}

/**
 * Build deterministic OSCAL metadata values for a generated catalog.
 *
 * @param {object} config Project configuration.
 * @param {object} catalog Catalog output configuration.
 * @returns {object} Catalog metadata used by XML generation.
 */
export function catalogMetadata(config, catalog) {
  return {
    uuid: deterministicUuid(`catalog:${config.metadata.version}:${catalog.id}`),
    title: catalog.title,
    lastModified: config.metadata.lastModified,
    version: config.metadata.version,
    oscalVersion: config.oscal.version
  };
}

/**
 * Build deterministic OSCAL metadata values for a generated profile.
 *
 * @param {object} config Project configuration.
 * @param {object} profile Profile output configuration.
 * @param {object} catalog Catalog output configuration imported by the profile.
 * @returns {object} Profile metadata used by XML generation.
 */
export function profileMetadata(config, profile, catalog) {
  const metadata = catalogMetadata(config, catalog);

  return {
    uuid: profileUuid({
      ...profile,
      version: metadata.version
    }),
    title: profile.title,
    lastModified: metadata.lastModified,
    version: metadata.version,
    oscalVersion: metadata.oscalVersion
  };
}

/**
 * Build deterministic OSCAL metadata values for a generated mapping collection.
 *
 * @param {object} config Project configuration.
 * @param {object} mapping Mapping output configuration.
 * @returns {object} Mapping collection metadata used by XML generation.
 */
export function mappingMetadata(config, mapping) {
  return {
    uuid: mappingCollectionUuid({
      ...mapping,
      version: config.metadata.version
    }),
    title: mapping.title,
    lastModified: config.metadata.lastModified,
    version: config.metadata.version,
    oscalVersion: config.oscal.version
  };
}

function createResourceRegistry() {
  const resourcesByUuid = new Map();

  return {
    add(resource) {
      resourcesByUuid.set(resource.uuid, {
        ...resourcesByUuid.get(resource.uuid),
        ...resource
      });

      return resource.uuid;
    },
    values() {
      return Array.from(resourcesByUuid.values());
    }
  };
}

function xmlModel(config) {
  const model = config.oscal.xmlModel;

  return `<?xml-model schematypens="${escapeXml(model.schematypens)}" type="${escapeXml(model.type)}" href="${escapeXml(model.href)}"?>`;
}

function revisionXml(config, catalog, revision) {
  const historyUuid = versionHistoryUuid(catalog, revision);

  return `      <revision>
        <title>${escapeXml(revision.title)}</title>
        <last-modified>${escapeXml(revision.lastModified)}</last-modified>
        <version>${escapeXml(revision.version)}</version>
        <oscal-version>${escapeXml(revision.oscalVersion ?? config.oscal.version)}</oscal-version>
        <link rel="version-history" href="#${escapeXml(historyUuid)}"/>
      </revision>`;
}

function revisionsXml(config, catalog) {
  return `    <revisions>
${config.metadata.revisions.map((revision) => revisionXml(config, catalog, revision)).join("\n")}
    </revisions>`;
}

function propAttributes(prop) {
  const attributes = [
    ["name", prop.name],
    ["value", prop.value],
    prop.ns ? ["ns", prop.ns] : undefined,
    prop.class ? ["class", prop.class] : undefined
  ].filter(Boolean);

  return attributes.map(([name, value]) => `${name}="${escapeXml(value)}"`).join(" ");
}

function metadataPropsXml(config) {
  const props = config.metadata.props ?? [];

  if (props.length === 0) {
    return "";
  }

  return `\n${props.map((prop) => `    <prop ${propAttributes(prop)}/>`).join("\n")}`;
}

function metadataLinksXml(config) {
  const links = config.metadata.links ?? [];

  if (links.length === 0) {
    return "";
  }

  return `\n${links
    .map((link) => `    <link rel="${escapeXml(link.rel)}" href="#${escapeXml(metadataLinkUuid(link))}"/>`)
    .join("\n")}`;
}

function roleTitle(role, artifactKind) {
  if (artifactKind === "profile" && role.profileTitle) {
    return role.profileTitle;
  }

  if (artifactKind === "mapping" && role.mappingTitle) {
    return role.mappingTitle;
  }

  return role.title;
}

function rolesXml(config, artifactKind = "catalog") {
  const roles = config.metadata.roles ?? [];

  if (roles.length === 0) {
    return "";
  }

  return `\n${roles
    .map(
      (role) => `    <role id="${escapeXml(role.id)}">
      <title>${escapeXml(roleTitle(role, artifactKind))}</title>
    </role>`
    )
    .join("\n")}`;
}

function partyById(config) {
  return new Map((config.metadata.parties ?? []).map((party) => [party.id, party]));
}

function partiesXml(config) {
  const parties = config.metadata.parties ?? [];

  if (parties.length === 0) {
    return "";
  }

  return `\n${parties
    .map((party) => {
      const emailAddresses = party.emailAddresses?.length
        ? `\n${party.emailAddresses
            .map((emailAddress) => `      <email-address>${escapeXml(emailAddress)}</email-address>`)
            .join("\n")}`
        : "";
      const address = party.address
        ? `\n      <address>${party.address.addrLines?.length ? `\n${party.address.addrLines
            .map((addrLine) => `        <addr-line>${escapeXml(addrLine)}</addr-line>`)
            .join("\n")}` : ""}
        <city>${escapeXml(party.address.city)}</city>
        <state>${escapeXml(party.address.state)}</state>
        <postal-code>${escapeXml(party.address.postalCode)}</postal-code>
      </address>`
        : "";

      return `    <party type="${escapeXml(party.type)}" uuid="${escapeXml(partyUuid(party))}">
      <name>${escapeXml(party.name)}</name>${party.shortName ? `\n      <short-name>${escapeXml(party.shortName)}</short-name>` : ""}${emailAddresses}${address}
    </party>`
    })
    .join("\n")}`;
}

function responsiblePartiesXml(config) {
  const responsibleParties = config.metadata.responsibleParties ?? [];

  if (responsibleParties.length === 0) {
    return "";
  }

  const parties = partyById(config);

  return `\n${responsibleParties
    .map((responsibleParty) => {
      const partyUuids = responsibleParty.partyIds.map((partyId) => {
        const party = parties.get(partyId);

        if (!party) {
          throw new Error(`Responsible party references unknown party id '${partyId}'.`);
        }

        return partyUuid(party);
      });

      return `    <responsible-party role-id="${escapeXml(responsibleParty.roleId)}">
${partyUuids.map((uuid) => `      <party-uuid>${escapeXml(uuid)}</party-uuid>`).join("\n")}
    </responsible-party>`;
    })
    .join("\n")}`;
}

function metadataResourceRecords(config, catalog) {
  const resources = [];

  for (const revision of config.metadata.revisions) {
    resources.push({
      uuid: versionHistoryUuid(catalog, revision),
      title: revision.versionHistory.title,
      rlinks: [
        {
          href: revision.versionHistory.href
        }
      ]
    });
  }

  for (const link of config.metadata.links ?? []) {
    resources.push({
      uuid: metadataLinkUuid(link),
      title: link.resource.title,
      rlinks: [
        {
          href: link.resource.href,
          mediaType: link.resource.mediaType
        }
      ]
    });
  }

  return resources;
}

function definitionEntries(rules) {
  const definitions = [];

  for (const [scope, scopedDefinitions] of Object.entries(rules.FRD?.data ?? {})) {
    for (const [id, definition] of Object.entries(scopedDefinitions)) {
      definitions.push({
        ...definition,
        id,
        scope
      });
    }
  }

  return definitions;
}

function definitionDescription(definition) {
  const paragraphs = [definition.definition];

  for (const note of [
    ...(Array.isArray(definition.notes) ? definition.notes : []),
    ...(definition.note ? [definition.note] : [])
  ]) {
    paragraphs.push(`Note: ${note}`);
  }

  if (definition.alts?.length) {
    paragraphs.push(`Also known as: ${definition.alts.join(", ")}`);
  }

  return paragraphs.filter(Boolean);
}

function definitionPayload(definition) {
  return definitionDescription(definition).join("\n\n");
}

function registerDefinitionResources(rules, registry) {
  const definitionsByTerm = new Map();

  for (const definition of definitionEntries(rules)) {
    const uuid = definitionUuid(definition.id);
    registry.add({
      uuid,
      title: `Definition: ${definition.term}`,
      citation: definition.reference,
      citationLinks: definition.reference_url
        ? [
            {
              rel: "source",
              href: definition.reference_url
            }
          ]
        : [],
      base64: {
        filename: `${definition.id}.txt`,
        mediaType: MEDIA_TYPE_TEXT_PLAIN,
        value: Buffer.from(definitionPayload(definition), "utf8").toString("base64")
      }
    });

    for (const term of [definition.term, ...(definition.alts ?? [])]) {
      definitionsByTerm.set(normalizeLookupValue(term), {
        ...definition,
        uuid
      });
    }
  }

  return definitionsByTerm;
}

function registerReferenceResource(reference, registry) {
  if (!reference.reference_url) {
    return undefined;
  }

  return registry.add({
    uuid: referenceUuid(reference),
    title: reference.reference ?? reference.reference_url,
    rlinks: [
      {
        href: reference.reference_url,
        mediaType: MEDIA_TYPE_TEXT_HTML
      }
    ]
  });
}

function linkXml(link) {
  const attributes = `rel="${escapeXml(link.rel)}" href="${escapeXml(link.href)}"`;

  if (link.text) {
    return `      <link ${attributes}>
        <text>${escapeXml(link.text)}</text>
      </link>`;
  }

  return `      <link ${attributes}/>`;
}

function controlLinks(item, context) {
  const links = [];
  const linkedDefinitionUuids = new Set();

  for (const term of item.terms ?? []) {
    const definition = context.definitionsByTerm.get(normalizeLookupValue(term));

    if (definition && !linkedDefinitionUuids.has(definition.uuid)) {
      linkedDefinitionUuids.add(definition.uuid);
      links.push({
        rel: "definition",
        href: `#${definition.uuid}`,
        text: term
      });
    }
  }

  if (item.reference_url) {
    const referenceUuid = registerReferenceResource(item, context.registry);

    if (referenceUuid) {
      links.push({
        rel: "reference",
        href: `#${referenceUuid}`
      });
    }
  }

  if (links.length === 0) {
    return "";
  }

  return `\n${links.map(linkXml).join("\n")}`;
}

function partXml({ id, name, className, paragraphs }) {
  const classAttribute = className ? ` class="${escapeXml(className)}"` : "";

  return `      <part id="${escapeXml(id)}" name="${escapeXml(name)}"${classAttribute}>
${paragraphs.map((paragraph) => `        <p>${escapeXml(paragraph)}</p>`).join("\n")}
      </part>`;
}

function statementParts(controlId, item) {
  const parts = [];

  if (item.statement) {
    parts.push({
      id: `${controlId}_smt`,
      name: "statement",
      paragraphs: [item.statement]
    });
  }

  for (const [classKey, variant] of Object.entries(item.varies_by_class ?? {})) {
    if (variant.statement) {
      parts.push({
        id: `${controlId}_smt_${classKey}`,
        name: "statement",
        className: `class-${classKey}`,
        paragraphs: [variant.statement]
      });
    }
  }

  return parts;
}

function noteParts(controlId, item) {
  const notes = [
    ...(Array.isArray(item.notes) ? item.notes : []),
    ...(item.note ? [item.note] : [])
  ].filter(Boolean);

  return notes.map((note, index) => ({
    id: `${controlId}_note_${index + 1}`,
    name: "guidance",
    className: "note",
    paragraphs: [note]
  }));
}

function artifactScopeParts(controlId, artifacts, { classKey } = {}) {
  const parts = [];

  for (const [scope, values] of Object.entries(artifacts ?? {})) {
    for (const [index, artifact] of artifactValues(values).entries()) {
      parts.push({
        id: artifactRequirementPartId(controlId, scope, index, { classKey }),
        name: "guidance",
        className: artifactRequirementClassName(scope, { classKey }),
        paragraphs: [artifact]
      });
    }
  }

  return parts;
}

function artifactParts(controlId, item) {
  const parts = [...artifactScopeParts(controlId, item.artifacts)];

  for (const [classKey, variant] of Object.entries(item.varies_by_class ?? {})) {
    parts.push(...artifactScopeParts(controlId, variant.artifacts, { classKey }));
  }

  return parts;
}

function controlPartsXml(controlId, item) {
  const parts = [...statementParts(controlId, item), ...noteParts(controlId, item), ...artifactParts(controlId, item)];

  if (parts.length === 0) {
    return "";
  }

  return `\n${parts.map((part) => partXml(part)).join("\n")}`;
}

function controlXml(id, item, className, context) {
  return `      <control class="${escapeXml(className)}" id="${escapeXml(id)}">
        <title>${escapeXml(item.name)}</title>${controlLinks(item, context)}${controlPartsXml(id, item)}
      </control>`;
}

function groupPartXml(name, value, indent = "    ") {
  if (!value) {
    return "";
  }

  return `\n${indent}<part name="${escapeXml(name)}">
${indent}  <p>${escapeXml(value)}</p>
${indent}</part>`;
}

function defaultArtifactPartsXml(rules, kind, indent = "  ") {
  const artifacts = rules.info?.default_artifacts?.[kind] ?? [];

  if (artifacts.length === 0) {
    return "";
  }

  return `\n${artifacts
    .map((artifact, index) =>
      partXml(
        {
          id: defaultArtifactRequirementPartId(kind, index),
          name: "instruction",
          className: "default-artifact",
          paragraphs: [artifact]
        },
        indent
      )
    )
    .join("\n")}`;
}

function frrControlsByLabel(ruleSet, catalog) {
  const labels = new Map();

  for (const scope of catalogScopes(catalog)) {
    for (const [label, controls] of Object.entries(dataForScope(ruleSet, scope))) {
      labels.set(label, [...(labels.get(label) ?? []), ...Object.entries(controls)]);
    }
  }

  return labels;
}

function frrRuleSetGroupXml(key, ruleSet, catalog, context) {
  const controlsByLabel = frrControlsByLabel(ruleSet, catalog);
  const labelGroups = [];
  const scopes = catalogScopes(catalog);

  for (const [label, controls] of controlsByLabel.entries()) {
    const labelInfo = findLabelInfo(ruleSet, label, scopes);

    labelGroups.push(`    <group class="section" id="${escapeXml(`${key}-${label}`)}">
      <title>${escapeXml(labelInfo.name)}</title>${groupPartXml("overview", labelInfo.description, "      ")}
${controls.map(([id, item]) => controlXml(id, item, "frr", context)).join("\n")}
    </group>`);
  }

  return `  <group class="rule-area" id="${escapeXml(key)}">
    <title>${escapeXml(ruleSet.info.name)}</title>${groupPartXml("overview", ruleSet.info.purpose)}
${labelGroups.join("\n")}
  </group>`;
}

function frrGroupXml(rules, catalog, context) {
  const ruleSetGroups = Object.entries(rules.FRR ?? {}).map(([key, ruleSet]) =>
    frrRuleSetGroupXml(key, ruleSet, catalog, context)
  );
  const defaultArtifacts = defaultArtifactPartsXml(rules, "FRR");

  if (ruleSetGroups.length === 0) {
    return "";
  }

  return `<group class="collection" id="FRR">
  <title>FedRAMP Requirements and Recommendations</title>${defaultArtifacts}
${ruleSetGroups.join("\n")}
</group>`;
}

function ksiThemeGroupXml(key, theme, context) {
  const controls = Object.entries(theme.indicators ?? {}).map(([id, item]) => controlXml(id, item, "ksi", context));

  return `  <group class="indicator-theme" id="${escapeXml(theme.id ?? `KSI-${key}`)}">
    <title>${escapeXml(theme.name)}</title>
${controls.join("\n")}
  </group>`;
}

function ksiGroupXml(rules, context) {
  const themeGroups = Object.entries(rules.KSI ?? {}).map(([key, theme]) => ksiThemeGroupXml(key, theme, context));
  const defaultArtifacts = defaultArtifactPartsXml(rules, "KSI");

  if (themeGroups.length === 0) {
    return "";
  }

  return `<group class="collection" id="KSI">
  <title>Key Security Indicators</title>${defaultArtifacts}
${themeGroups.join("\n")}
</group>`;
}

function catalogGroupsXml(rules, catalog, context) {
  const groups = [frrGroupXml(rules, catalog, context)];

  if (includesKsi(catalog)) {
    groups.push(ksiGroupXml(rules, context));
  }

  return groups.filter(Boolean).join("\n");
}

function rlinkAttributes(rlink) {
  const attributes = [
    rlink.mediaType ? ["media-type", rlink.mediaType] : undefined,
    ["href", rlink.href]
  ].filter(Boolean);

  return attributes.map(([name, value]) => `${name}="${escapeXml(value)}"`).join(" ");
}

function resourceXml(resource) {
  const title = resource.title ? `\n      <title>${escapeXml(resource.title)}</title>` : "";
  const description = resource.description?.length
    ? `\n      <description>
${resource.description.map((paragraph) => `        <p>${escapeXml(paragraph)}</p>`).join("\n")}
      </description>`
    : "";
  const citation = resource.citation
    ? `\n      <citation>
        <text>${escapeXml(resource.citation)}</text>${resource.citationLinks?.length ? `\n${resource.citationLinks
          .map((link) => `        <link rel="${escapeXml(link.rel)}" href="${escapeXml(link.href)}"/>`)
          .join("\n")}` : ""}
      </citation>`
    : "";
  const rlinks = resource.rlinks?.length
    ? `\n${resource.rlinks.map((rlink) => `      <rlink ${rlinkAttributes(rlink)}/>`).join("\n")}`
    : "";
  const base64 = resource.base64
    ? `\n      <base64 filename="${escapeXml(resource.base64.filename)}" media-type="${escapeXml(resource.base64.mediaType)}">${escapeXml(resource.base64.value)}</base64>`
    : "";

  return `    <resource uuid="${escapeXml(resource.uuid)}">${title}${description}${citation}${rlinks}${base64}
    </resource>`;
}

function backMatterXml(resources) {
  return `  <back-matter>
${resources.map(resourceXml).join("\n")}
  </back-matter>`;
}

function profileImportXml(resourceUuid, controlIds) {
  if (controlIds.length === 0) {
    throw new Error("Profile import must include at least one control ID.");
  }

  return `  <import href="#${escapeXml(resourceUuid)}">
    <include-controls>
${controlIds.map((id) => `      <with-id>${escapeXml(id)}</with-id>`).join("\n")}
    </include-controls>
  </import>`;
}

function profileMergeXml() {
  return `  <merge>
    <as-is>true</as-is>
  </merge>`;
}

function profileCatalogResource(config, profile, catalog) {
  const metadata = profileMetadata(config, profile, catalog);

  return {
    uuid: profileCatalogResourceUuid(
      {
        ...profile,
        version: metadata.version
      },
      catalog
    ),
    description: [catalog.title],
    rlinks: catalogOutputFormats(config).map((format) => ({
      mediaType: `${OSCAL_CATALOG_MEDIA_TYPE_PREFIX}${format.id}`,
      href: `../../../${catalog.folder}/${format.folder}/${catalog.filenameBase}.${format.extension}`
    }))
  };
}

/**
 * Create an OSCAL profile XML document for a configured FedRAMP profile shell.
 *
 * @param {object} rules FedRAMP CR26 source rules.
 * @param {object} config Project configuration.
 * @param {object} profile Profile output configuration.
 * @param {object} catalog Catalog output configuration imported by the profile.
 * @returns {string} OSCAL profile XML.
 */
export function createProfileXml(rules, config, profile, catalog) {
  const metadata = profileMetadata(config, profile, catalog);
  const catalogResource = profileCatalogResource(config, profile, catalog);
  const controlIds = profileControlIds(rules, profile);

  return `<?xml version="1.0" encoding="UTF-8"?>${xmlModel(config)}<profile xmlns="${escapeXml(config.oscal.namespace)}" uuid="${escapeXml(metadata.uuid)}">
  <metadata>
    <title>${escapeXml(metadata.title)}</title>
    <last-modified>${escapeXml(metadata.lastModified)}</last-modified>
    <version>${escapeXml(metadata.version)}</version>
    <oscal-version>${escapeXml(metadata.oscalVersion)}</oscal-version>${rolesXml(config, "profile")}${partiesXml(config)}${responsiblePartiesXml(config)}
  </metadata>
${profileImportXml(catalogResource.uuid, controlIds)}
${profileMergeXml()}
${backMatterXml([catalogResource])}
</profile>
`;
}

function mappingResourceReferenceXml(name, resource) {
  return `    <${name} type="${escapeXml(resource.type)}" href="${escapeXml(resource.href)}"/>`;
}

function mapXml(mapping, entry) {
  return mapEntryXml({
    uuid: mapUuid(mapping, entry),
    relationship: mapping.relationship,
    sourceItemType: entry.sourceItemType ?? "control",
    targetItemType: entry.targetItemType ?? "control",
    sourceIds: entry.sourceIds,
    targetId: entry.targetId
  });
}

function mappingXml(rules, config, mapping, context) {
  const metadata = mappingMetadata(config, mapping);
  const versionedMapping = {
    ...mapping,
    version: metadata.version
  };
  const entries = mappingEntries(rules, mapping, context);

  if (entries.length === 0) {
    throw new Error(`Mapping collection '${mapping.id}' has no mapped entries.`);
  }

  return `  <mapping uuid="${escapeXml(mappingUuid(versionedMapping))}" method="${escapeXml(mapping.method)}" matching-rationale="${escapeXml(mapping.matchingRationale)}" status="${escapeXml(mapping.status)}">
${mappingResourceReferenceXml("source-resource", mapping.sourceResource)}
${mappingResourceReferenceXml("target-resource", mapping.targetResource)}
${entries.map((entry) => mapXml(versionedMapping, entry)).join("\n")}
  </mapping>`;
}

/**
 * Create an OSCAL mapping collection XML document from NIST references in CR26 source hints.
 *
 * @param {object} rules FedRAMP CR26 source rules.
 * @param {object} config Project configuration.
 * @param {object} mapping Mapping output configuration.
 * @param {object} context Additional source context used by mapping generation.
 * @returns {string} OSCAL mapping collection XML.
 */
export function createMappingCollectionXml(rules, config, mapping, context = {}) {
  const metadata = mappingMetadata(config, mapping);

  return `<?xml version="1.0" encoding="UTF-8"?>${xmlModel(config)}<mapping-collection xmlns="${escapeXml(config.oscal.namespace)}" uuid="${escapeXml(metadata.uuid)}">
  <metadata>
    <title>${escapeXml(metadata.title)}</title>
    <last-modified>${escapeXml(metadata.lastModified)}</last-modified>
    <version>${escapeXml(metadata.version)}</version>
    <oscal-version>${escapeXml(metadata.oscalVersion)}</oscal-version>${rolesXml(config, "mapping")}${partiesXml(config)}${responsiblePartiesXml(config)}
  </metadata>
  <provenance method="${escapeXml(mapping.method)}" matching-rationale="${escapeXml(mapping.matchingRationale)}" status="${escapeXml(mapping.status)}">
    <mapping-description>
      <p>${escapeXml(mapping.description)}</p>
    </mapping-description>
  </provenance>
${mappingXml(rules, config, mapping, context)}
</mapping-collection>
`;
}

/**
 * Create an OSCAL catalog XML document for a configured CR26 catalog output.
 *
 * @param {object} rules FedRAMP CR26 source rules.
 * @param {object} config Project configuration.
 * @param {object} catalog Catalog output configuration.
 * @returns {string} OSCAL catalog XML.
 */
export function createCatalogXml(rules, config, catalog) {
  const metadata = catalogMetadata(config, catalog);
  const registry = createResourceRegistry();

  for (const resource of metadataResourceRecords(config, catalog)) {
    registry.add(resource);
  }

  const context = {
    definitionsByTerm: registerDefinitionResources(rules, registry),
    registry
  };
  const groupsXml = catalogGroupsXml(rules, catalog, context);

  return `<?xml version="1.0" encoding="UTF-8"?>${xmlModel(config)}<catalog xmlns="${escapeXml(config.oscal.namespace)}" uuid="${escapeXml(metadata.uuid)}">
  <metadata>
    <title>${escapeXml(metadata.title)}</title>
    <last-modified>${escapeXml(metadata.lastModified)}</last-modified>
    <version>${escapeXml(metadata.version)}</version>
    <oscal-version>${escapeXml(metadata.oscalVersion)}</oscal-version>
${revisionsXml(config, catalog)}${metadataPropsXml(config)}${metadataLinksXml(config)}${rolesXml(config)}${partiesXml(config)}${responsiblePartiesXml(config)}
  </metadata>
${groupsXml}
${backMatterXml(registry.values())}
</catalog>
`;
}

/**
 * Create XML catalog output records that can be written by the CLI.
 *
 * @param {object} rules FedRAMP CR26 source rules.
 * @param {object} config Project configuration.
 * @returns {Array<object>} Catalog output records.
 */
export function createCatalogOutputs(rules, config) {
  const xmlFormat = catalogOutputFormats(config).find((format) => format.id === "xml");

  if (!xmlFormat) {
    throw new Error("Output formats must include an 'xml' format.");
  }

  return config.output.catalogs.map((catalog) => ({
    catalog,
    format: xmlFormat,
    path: catalogOutputPath(config, catalog, xmlFormat),
    xml: createCatalogXml(rules, config, catalog)
  }));
}

/**
 * Resolve configured catalog serialization formats.
 *
 * @param {object} config Project configuration.
 * @returns {Array<object>} Catalog output format records.
 */
export function catalogOutputFormats(config) {
  return config.output.formats ?? [
    {
      id: "xml",
      folder: "xml",
      extension: "xml"
    }
  ];
}

/**
 * Build the relative output path for a catalog artifact.
 *
 * @param {object} config Project configuration.
 * @param {object} catalog Catalog output configuration.
 * @param {object} format Output format configuration.
 * @returns {string[]} Relative path segments.
 */
export function catalogOutputPath(config, catalog, format) {
  if (!catalog.filenameBase) {
    throw new Error(`Catalog '${catalog.id}' must provide filenameBase.`);
  }

  return [config.output.rootFolder, catalog.folder, format.folder, `${catalog.filenameBase}.${format.extension}`];
}

/**
 * Build the relative output path for a profile artifact.
 *
 * @param {object} config Project configuration.
 * @param {object} profile Profile output configuration.
 * @param {object} format Output format configuration.
 * @returns {string[]} Relative path segments.
 */
export function profileOutputPath(config, profile, format) {
  const profileConfig = config.output.profile;

  if (!profileConfig) {
    throw new Error("Profile output configuration is missing.");
  }

  if (!profile.filenameBase) {
    throw new Error(`Profile '${profile.id}' must provide filenameBase.`);
  }

  return [
    config.output.rootFolder,
    profileConfig.folder,
    profile.folder,
    format.folder,
    `${profile.filenameBase}.${format.extension}`
  ];
}

/**
 * Resolve configured mapping collection serialization formats.
 *
 * @param {object} config Project configuration.
 * @returns {Array<object>} Mapping output format records.
 */
export function mappingOutputFormats(config) {
  return config.output.mapping?.formats ?? [
    {
      id: "xml",
      folder: "xml",
      extension: "xml"
    }
  ];
}

/**
 * Build the relative output path for a mapping collection artifact.
 *
 * @param {object} config Project configuration.
 * @param {object} mapping Mapping output configuration.
 * @param {object} format Output format configuration.
 * @returns {string[]} Relative path segments.
 */
export function mappingOutputPath(config, mapping, format) {
  const mappingConfig = config.output.mapping;

  if (!mappingConfig) {
    throw new Error("Mapping output configuration is missing.");
  }

  if (!mapping.filenameBase) {
    throw new Error(`Mapping '${mapping.id}' must provide filenameBase.`);
  }

  return [config.output.rootFolder, mappingConfig.folder, format.folder, `${mapping.filenameBase}.${format.extension}`];
}

/**
 * Create non-XML catalog conversion records that can be produced from XML.
 *
 * @param {object} config Project configuration.
 * @param {object} catalog Catalog output configuration.
 * @returns {Array<object>} Catalog conversion records.
 */
export function convertedCatalogOutputs(config, catalog) {
  return catalogOutputFormats(config)
    .filter((format) => format.id !== "xml")
    .map((format) => ({
      catalog,
      format,
      path: catalogOutputPath(config, catalog, format)
    }));
}

/**
 * Create XML profile output records that can be written by the CLI.
 *
 * @param {object} rules FedRAMP CR26 source rules.
 * @param {object} config Project configuration.
 * @returns {Array<object>} Profile output records.
 */
export function createProfileOutputs(rules, config) {
  const profileConfig = config.output.profile;
  const xmlFormat = catalogOutputFormats(config).find((format) => format.id === "xml");
  const [catalog] = config.output.catalogs;

  if (!profileConfig || !xmlFormat) {
    return [];
  }

  if (!catalog) {
    throw new Error("At least one catalog is required to generate profile shells.");
  }

  return (profileConfig.profiles ?? []).map((profile) => ({
    profile,
    catalog,
    format: xmlFormat,
    path: profileOutputPath(config, profile, xmlFormat),
    xml: createProfileXml(rules, config, profile, catalog)
  }));
}

/**
 * Create XML mapping collection output records that can be written by the CLI.
 *
 * @param {object} rules FedRAMP CR26 source rules.
 * @param {object} config Project configuration.
 * @param {object} options Additional source inputs used by mapping generation.
 * @returns {Array<object>} Mapping output records.
 */
export function createMappingOutputs(rules, config, options = {}) {
  const mappingConfig = config.output.mapping;
  const xmlFormat = mappingOutputFormats(config).find((format) => format.id === "xml");
  const context = {
    ...options,
    nistStatementIndex: options.nistStatementIndex ?? (options.nistCatalog ? createNistStatementIndex(options.nistCatalog) : undefined)
  };

  if (!mappingConfig || !xmlFormat) {
    return [];
  }

  return (mappingConfig.mappings ?? []).map((mapping) => ({
    mapping,
    format: xmlFormat,
    path: mappingOutputPath(config, mapping, xmlFormat),
    xml: createMappingCollectionXml(rules, config, mapping, context)
  }));
}

/**
 * Create non-XML profile conversion records that can be produced from XML.
 *
 * @param {object} config Project configuration.
 * @param {object} profile Profile output configuration.
 * @returns {Array<object>} Profile conversion records.
 */
export function convertedProfileOutputs(config, profile) {
  return catalogOutputFormats(config)
    .filter((format) => format.id !== "xml")
    .map((format) => ({
      profile,
      format,
      path: profileOutputPath(config, profile, format)
    }));
}
