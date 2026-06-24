import { readFile } from "node:fs/promises";
import { readKsiMappings } from "../mapping/collection.js";

function rootObject(document) {
  const [rootName] = Object.keys(document);
  return document[rootName];
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function readText(path) {
  return readFile(path, "utf8");
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function uniqueFolded(values) {
  const seen = new Set();
  const folded = [];

  for (const value of values.filter(Boolean)) {
    const key = value.toLowerCase();

    if (!seen.has(key)) {
      seen.add(key);
      folded.push(value);
    }
  }

  return folded;
}

function sentence(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function titleCaseStatus(state) {
  if (state === "implemented") {
    return "Implemented";
  }

  if (state === "planned" || state === "partial") {
    return "Partially Implemented";
  }

  return "Not Implemented";
}

function implementedRequirements(ssp) {
  return ssp["control-implementation"]?.["implemented-requirements"] ?? [];
}

function reviewedControls(reviewedControls) {
  return (reviewedControls?.["control-selections"] ?? []).flatMap((selection) =>
    selection["include-controls"] ?? []
  );
}

function activitySteps(ap) {
  return (ap["local-definitions"]?.activities ?? []).flatMap((activity) =>
    (activity.steps ?? []).map((step) => ({
      ...step,
      activityTitle: activity.title
    }))
  );
}

function matchingSteps(ap, controlIds, statementIds) {
  const controls = new Set(controlIds);
  const statements = new Set(statementIds);

  return activitySteps(ap).filter((step) =>
    reviewedControls(step["reviewed-controls"]).some((control) => {
      if (controls.has(control["control-id"])) {
        return true;
      }

      return (control["statement-ids"] ?? []).some((statementId) => statements.has(statementId));
    })
  );
}

function resultEntries(ar) {
  return ar.results ?? [];
}

function findingsForSteps(ar, steps) {
  const stepUuids = new Set(steps.map((step) => step.uuid));
  const findings = [];
  const observations = [];

  for (const result of resultEntries(ar)) {
    const observationsByUuid = new Map((result.observations ?? []).map((observation) => [observation.uuid, observation]));
    const matchingObservationUuids = new Set(
      (result.observations ?? [])
        .filter((observation) =>
          (observation.subjects ?? []).some((subject) => stepUuids.has(subject["subject-uuid"]))
        )
        .map((observation) => observation.uuid)
    );

    observations.push(...[...matchingObservationUuids].map((uuid) => observationsByUuid.get(uuid)).filter(Boolean));
    findings.push(
      ...(result.findings ?? []).filter((finding) =>
        (finding["related-observations"] ?? []).some((related) =>
          matchingObservationUuids.has(related["observation-uuid"])
        )
      )
    );
  }

  return { findings, observations };
}

function controlImplementationStatus(requirement) {
  const states = (requirement["by-components"] ?? []).map((component) => component["implementation-status"]?.state);

  if (states.length > 0 && states.every((state) => state === "implemented")) {
    return "Implemented";
  }

  if (states.some((state) => state === "implemented" || state === "planned")) {
    return "Partially Implemented";
  }

  return titleCaseStatus(states[0]);
}

function implementationStatements(requirements) {
  return unique(
    requirements.flatMap((requirement) =>
      (requirement["by-components"] ?? []).map((component) => sentence(component.description))
    )
  );
}

function validationStatements(steps) {
  return unique(
    steps.map((step) =>
      sentence(`${step.title}: ${step.description}${step.remarks ? ` ${step.remarks}` : ""}`)
    )
  );
}

function assessmentStatements(findings, observations) {
  return unique([
    ...findings.map((finding) =>
      sentence(`${finding.title}: ${finding.description} Status: ${finding.target?.status?.state ?? "unknown"}.`)
    ),
    ...observations.map((observation) =>
      sentence(`${observation.title}: ${observation.description}`)
    )
  ]);
}

function evidenceEntries(observations) {
  return observations.map((observation) => ({
    evidenceType: "Audit Record",
    evidenceDescription: sentence(observation.title),
    evidenceText: sentence(observation.description),
    lastUpdated: observation.collected?.slice(0, 10)
  }));
}

function securityControls(requirements) {
  return requirements.map((requirement) => ({
    controlId: requirement["control-id"],
    parameterValues: [],
    controlImplementationStatus: controlImplementationStatus(requirement),
    controlImplementationDescription: implementationStatements([requirement]).join("\n\n")
  }));
}

function keySecurityIndicator(ksiId, requirements, steps, findings, observations) {
  return {
    ksiId,
    ksiImplementation: implementationStatements(requirements),
    ksiValidation: validationStatements(steps),
    ksiAssessment: assessmentStatements(findings, observations),
    ksiTests: uniqueFolded([
      ...steps.map((step) => step.title),
      ...findings.map((finding) => finding.target?.["target-id"])
    ]),
    ksiEvidence: evidenceEntries(observations)
  };
}

export async function createSdr(options) {
  const ssp = rootObject(await readJson(options.ssp));
  const ap = rootObject(await readJson(options.ap));
  const ar = rootObject(await readJson(options.ar));
  const mappingsByKsi = readKsiMappings(await readText(options.mapping));
  const requirements = implementedRequirements(ssp);
  const requirementsByControlId = new Map(requirements.map((requirement) => [requirement["control-id"], requirement]));
  const keySecurityIndicators = [];
  const usedControlIds = new Set();

  for (const [ksiId, mapping] of mappingsByKsi) {
    const mappedRequirements = mapping.controlIds
      .map((controlId) => requirementsByControlId.get(controlId))
      .filter(Boolean);

    if (mappedRequirements.length === 0) {
      continue;
    }

    const steps = matchingSteps(ap, mapping.controlIds, mapping.statementIds);
    const { findings, observations } = findingsForSteps(ar, steps);

    for (const requirement of mappedRequirements) {
      usedControlIds.add(requirement["control-id"]);
    }

    keySecurityIndicators.push(keySecurityIndicator(ksiId, mappedRequirements, steps, findings, observations));
  }

  const usedRequirements = [...usedControlIds].map((controlId) => requirementsByControlId.get(controlId)).filter(Boolean);

  return {
    certificationPackageOverviewUri: options.certificationPackageOverviewUri,
    fedRampRequirements: [],
    keySecurityIndicators,
    securityControls: securityControls(usedRequirements)
  };
}
