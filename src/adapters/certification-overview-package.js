import { readFile } from "node:fs/promises";

export const DEFAULT_CERTIFICATION_OVERVIEW_MAPPING_PATH = "mappings/fedramp/certification-overview-package.json";

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function rootObject(document) {
  const [rootName] = Object.keys(document);
  return document[rootName];
}

function propValue(props, name) {
  return props?.find((prop) => prop.name === name)?.value;
}

function partyByUuid(metadata, uuid) {
  return metadata.parties?.find((party) => party.uuid === uuid);
}

function partyForRole(metadata, roleId) {
  const responsibleParty = metadata["responsible-parties"]?.find((party) => party["role-id"] === roleId);
  return partyByUuid(metadata, responsibleParty?.["party-uuids"]?.[0]);
}

function contactForRole(metadata, roleId, contactType) {
  const party = partyForRole(metadata, roleId);

  return {
    contactType,
    contactName: party?.name,
    contactEmail: party?.["email-addresses"]?.[0]
  };
}

function digitalIdentityLevel(props) {
  const identity = propValue(props, "identity-assurance-level");
  const authenticator = propValue(props, "authenticator-assurance-level");
  const federation = propValue(props, "federation-assurance-level");

  return [
    identity && `IAL${identity}`,
    authenticator && `AAL${authenticator}`,
    federation && `FAL${federation}`
  ].filter(Boolean).join(" / ");
}

function serviceType(value) {
  const values = {
    iaas: "IaaS",
    paas: "PaaS",
    saas: "SaaS"
  };

  return values[value] ?? value;
}

function deploymentModel(value) {
  const values = {
    "community-cloud": "Community Cloud",
    "government-only-cloud": "Government-Only Cloud",
    "hybrid-cloud": "Hybrid Cloud",
    "public-cloud": "Public Cloud"
  };

  return values[value] ?? value;
}

function pathValue(source, path) {
  return path.split(".").reduce((value, segment) => {
    if (value === undefined || value === null) {
      return undefined;
    }

    const match = segment.match(/^(.+)\[(\d+)\]$/);

    if (match) {
      return value[match[1]]?.[Number(match[2])];
    }

    if (segment === "props") {
      return value.props;
    }

    return value[segment];
  }, source);
}

function sourceValue(ssp, source) {
  if (source.endsWith(".props")) {
    return pathValue(ssp, source);
  }

  const propMatch = source.match(/^(.*)\.props\.([^.]*)$/);

  if (propMatch) {
    return propValue(pathValue(ssp, `${propMatch[1]}.props`), propMatch[2]);
  }

  return pathValue(ssp, source);
}

const valueTransforms = {
  cloudServiceModel: (value) => value?.split(",").map((item) => serviceType(item.trim())),
  cloudDeploymentModel: (value) => deploymentModel(value)
};

const derivedTransforms = {
  partyNameForRole: ({ metadata }, rule) => partyForRole(metadata, rule.roleId)?.name,
  metadataLink: ({ metadata }, rule) => metadata.links?.find((link) => link.rel === rule.rel)?.href,
  digitalIdentityLevel: ({ serviceProps }) => digitalIdentityLevel(serviceProps),
  contactsForRoles: ({ metadata }, rule) =>
    rule.roles.map((role) => contactForRole(metadata, role.roleId, role.contactType)),
  assessorForRole: ({ metadata }, rule) => {
    const assessor = partyForRole(metadata, rule.roleId);

    return {
      name: assessor?.name,
      id: propValue(assessor?.props, "assessor-id")
    };
  }
};

function projectionContext(ssp) {
  const metadata = ssp.metadata ?? {};
  const systemCharacteristics = ssp["system-characteristics"] ?? {};

  return {
    metadata,
    systemCharacteristics,
    serviceProps: systemCharacteristics.props ?? []
  };
}

function projectionValue(ssp, rule) {
  const context = projectionContext(ssp);
  const value = rule.source ? sourceValue(ssp, rule.source) : undefined;

  if (rule.source && rule.transform) {
    const transform = valueTransforms[rule.transform];

    if (!transform) {
      throw new Error(`Unknown projection transform: ${rule.transform}`);
    }

    return transform(value, context, rule);
  }

  if (rule.transform) {
    const transform = derivedTransforms[rule.transform];

    if (!transform) {
      throw new Error(`Unknown projection transform: ${rule.transform}`);
    }

    return transform(context, rule);
  }

  return value;
}

function requireProjectedValue(path, value) {
  if (value === undefined || value === null || value === "") {
    throw new Error(`Missing required source value for ${path}`);
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      throw new Error(`Missing required source value for ${path}`);
    }

    value.forEach((item, index) => requireProjectedValue(`${path}[${index}]`, item));
  } else if (typeof value === "object") {
    Object.entries(value).forEach(([key, item]) => requireProjectedValue(`${path}.${key}`, item));
  }

  return value;
}

function projectObject(ssp, rules, path = "") {
  return Object.fromEntries(
    Object.entries(rules).map(([target, rule]) => {
      const targetPath = path ? `${path}.${target}` : target;
      const value = rule.transform || rule.source ? projectionValue(ssp, rule) : projectObject(ssp, rule, targetPath);
      return [target, requireProjectedValue(targetPath, value)];
    })
  );
}

export async function createCertificationOverviewPackage(options) {
  const ssp = rootObject(await readJson(options.ssp));
  const mapping = await readJson(options.mapping ?? DEFAULT_CERTIFICATION_OVERVIEW_MAPPING_PATH);
  return projectObject(ssp, mapping);
}
