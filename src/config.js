import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export const DEFAULT_CONFIG_PATH = "cr26-oscal.config.json";

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function metadataProp(prop) {
  if (typeof prop.value === "string") {
    return {
      name: prop.name,
      value: prop.value
    };
  }

  if (Array.isArray(prop.values)) {
    return {
      name: prop.name,
      value: prop.values.join(prop.separator ?? ", ")
    };
  }

  throw new Error(`Metadata prop '${prop.name}' must provide either value or values.`);
}

function metadataLink(link) {
  if (!link.rel) {
    throw new Error("Metadata link must provide rel.");
  }

  if (!link.resource?.title || !link.resource?.href) {
    throw new Error(`Metadata link '${link.rel}' must provide resource title and href.`);
  }

  return {
    rel: link.rel,
    resource: {
      title: link.resource.title,
      href: link.resource.href,
      mediaType: link.resource.mediaType
    }
  };
}

function metadataRole(role) {
  if (!role.id || !role.title) {
    throw new Error("Metadata role must provide id and title.");
  }

  return {
    id: role.id,
    title: role.title,
    profileTitle: role.profileTitle,
    mappingTitle: role.mappingTitle
  };
}

function metadataParty(party) {
  if (!party.id || !party.type || !party.name) {
    throw new Error("Metadata party must provide id, type, and name.");
  }

  if (party.emailAddresses && !Array.isArray(party.emailAddresses)) {
    throw new Error(`Metadata party '${party.id}' emailAddresses must be an array.`);
  }

  if (party.address && (!party.address.city || !party.address.state || !party.address.postalCode)) {
    throw new Error(`Metadata party '${party.id}' address must provide city, state, and postalCode.`);
  }

  return {
    id: party.id,
    uuid: party.uuid,
    type: party.type,
    name: party.name,
    shortName: party.shortName,
    emailAddresses: party.emailAddresses ?? [],
    address: party.address
  };
}

function responsibleParty(responsibility) {
  if (!responsibility.roleId || !Array.isArray(responsibility.partyIds)) {
    throw new Error("Responsible party must provide roleId and partyIds.");
  }

  return {
    roleId: responsibility.roleId,
    partyIds: responsibility.partyIds
  };
}

async function loadReferencedItems(config, configPath, referenceKey, itemKey, mapper) {
  const references = config.metadata?.[referenceKey] ?? [];
  const configDir = dirname(resolve(configPath));
  const referencedItems = [];

  for (const reference of references) {
    const referencePath = resolve(configDir, reference);
    const referenceConfig = await readJson(referencePath);
    referencedItems.push(...(referenceConfig[itemKey] ?? []).map(mapper));
  }

  return referencedItems;
}

async function loadReferencedResponsibilities(config, configPath) {
  const references = config.metadata?.responsibilityReferences ?? [];
  const configDir = dirname(resolve(configPath));
  const referenced = {
    roles: [],
    parties: [],
    responsibleParties: []
  };

  for (const reference of references) {
    const referencePath = resolve(configDir, reference);
    const referenceConfig = await readJson(referencePath);
    referenced.roles.push(...(referenceConfig.roles ?? []).map(metadataRole));
    referenced.parties.push(...(referenceConfig.parties ?? []).map(metadataParty));
    referenced.responsibleParties.push(...(referenceConfig.responsibleParties ?? []).map(responsibleParty));
  }

  return referenced;
}

async function loadMetadataReferences(config, configPath) {
  const referencedProps = await loadReferencedItems(config, configPath, "propReferences", "props", metadataProp);
  const referencedLinks = await loadReferencedItems(config, configPath, "linkReferences", "links", metadataLink);
  const referencedResponsibilities = await loadReferencedResponsibilities(config, configPath);

  return {
    ...config,
    metadata: {
      ...config.metadata,
      props: [...(config.metadata?.props ?? []), ...referencedProps],
      links: [...(config.metadata?.links ?? []), ...referencedLinks],
      roles: [...(config.metadata?.roles ?? []), ...referencedResponsibilities.roles],
      parties: [...(config.metadata?.parties ?? []), ...referencedResponsibilities.parties],
      responsibleParties: [
        ...(config.metadata?.responsibleParties ?? []),
        ...referencedResponsibilities.responsibleParties
      ]
    }
  };
}

/**
 * Load the project configuration and expand metadata reference files.
 *
 * @param {string} [path=DEFAULT_CONFIG_PATH] Path to the project config file.
 * @returns {Promise<object>} Resolved project configuration.
 */
export async function loadConfig(path = DEFAULT_CONFIG_PATH) {
  const config = await readJson(path);
  return loadMetadataReferences(config, path);
}
