import fs from 'node:fs/promises';
import path from 'node:path';
import { assertFinalUrlOrigin, normalizeHttpOrigin } from './url-safety.mjs';

// Lighthouse 12's installed Result.GatherMode type permits exactly these values.
const ALLOWED_GATHER_MODES = new Set(['navigation', 'timespan', 'snapshot']);

async function readJsonFile(filePath, label) {
  let source;
  try {
    source = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`${label} is missing: ${filePath}`);
    }
    throw error;
  }
  try {
    return JSON.parse(source);
  } catch {
    throw new Error(`${label} is not valid JSON: ${filePath}`);
  }
}

function containedPath(outputDir, candidate, field) {
  if (typeof candidate !== 'string' || !candidate.trim()) {
    throw new Error(`Lighthouse manifest ${field} must be a non-empty path`);
  }
  const resolved = path.resolve(candidate);
  const relative = path.relative(outputDir, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(
      `Lighthouse manifest ${field} must stay inside the current Lighthouse run directory`,
    );
  }
  return resolved;
}

async function assertRegularFile(filePath, label) {
  let stat;
  try {
    stat = await fs.lstat(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`${label} is missing: ${filePath}`);
    }
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a regular non-symlink file: ${filePath}`);
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isContainedBy(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function assertNoSymlinkAncestors(filePath, outputDir, label) {
  const relative = path.relative(outputDir, filePath);
  const ancestorNames = relative.split(path.sep).slice(0, -1);
  let ancestorPath = outputDir;
  for (const ancestorName of ancestorNames) {
    ancestorPath = path.join(ancestorPath, ancestorName);
    const stat = await fs.lstat(ancestorPath);
    if (stat.isSymbolicLink()) {
      throw new Error(`${label} must not have symlink ancestors: ${filePath}`);
    }
  }
}

async function assertCanonicalFileContained(
  filePath,
  outputDir,
  canonicalOutputDir,
  label,
) {
  await assertRegularFile(filePath, label);
  const canonicalPath = await fs.realpath(filePath);
  if (!isContainedBy(canonicalOutputDir, canonicalPath)) {
    throw new Error(
      `${label} canonical path escapes the current Lighthouse run directory: ${filePath}`,
    );
  }
  await assertNoSymlinkAncestors(filePath, outputDir, label);
  return canonicalPath;
}

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

export function assertLhrStructure(report, label) {
  for (const field of ['fetchTime', 'requestedUrl', 'finalUrl', 'finalDisplayedUrl']) {
    assertNonEmptyString(report[field], `${label} ${field}`);
  }
  if (typeof report.lighthouseVersion !== 'string' || !report.lighthouseVersion.trim()) {
    throw new Error(`${label} lighthouseVersion must be a non-empty string`);
  }
  if (!ALLOWED_GATHER_MODES.has(report.gatherMode)) {
    throw new Error(
      `${label} gatherMode must be one of navigation, timespan, snapshot`,
    );
  }
  if (!isPlainObject(report.categories)) {
    throw new Error(`${label} categories must be a plain object`);
  }
  if (!isPlainObject(report.categories.performance)) {
    throw new Error(`${label} categories.performance must be a plain object`);
  }
  const performance = report.categories.performance;
  if (performance.id !== 'performance') {
    throw new Error(`${label} categories.performance.id must equal performance`);
  }
  assertNonEmptyString(
    performance.title,
    `${label} categories.performance.title`,
  );
  if (!Array.isArray(performance.auditRefs) || performance.auditRefs.length === 0) {
    throw new Error(`${label} categories.performance.auditRefs must be a non-empty array`);
  }
  const performanceScore = performance.score;
  // Lighthouse's installed LHR schema permits null when a category cannot be scored.
  if (
    performanceScore !== null
    && (
      !Number.isFinite(performanceScore)
      || performanceScore < 0
      || performanceScore > 1
    )
  ) {
    throw new Error(
      `${label} categories.performance.score must be null or a finite number from 0 to 1`,
    );
  }
  if (!isPlainObject(report.audits)) {
    throw new Error(`${label} audits must be a plain object`);
  }

  performance.auditRefs.forEach((auditRef, index) => {
    const auditRefLabel = `${label} categories.performance.auditRefs[${index}]`;
    if (!isPlainObject(auditRef)) {
      throw new Error(`${auditRefLabel} must be a plain object`);
    }
    assertNonEmptyString(auditRef.id, `${auditRefLabel}.id`);
    if (!Number.isFinite(auditRef.weight) || auditRef.weight < 0) {
      throw new Error(`${auditRefLabel}.weight must be a finite non-negative number`);
    }
    for (const optionalStringField of ['group', 'acronym']) {
      if (
        Object.prototype.hasOwnProperty.call(auditRef, optionalStringField)
        && typeof auditRef[optionalStringField] !== 'string'
      ) {
        throw new Error(
          `${auditRefLabel}.${optionalStringField} must be a string when present`,
        );
      }
    }

    const hasReferencedAudit = Object.prototype.hasOwnProperty.call(
      report.audits,
      auditRef.id,
    );
    const referencedAudit = report.audits[auditRef.id];
    if (!hasReferencedAudit || !isPlainObject(referencedAudit)) {
      throw new Error(
        `${auditRefLabel} must reference an existing plain-object audit: ${auditRef.id}`,
      );
    }
    if (referencedAudit.id !== auditRef.id) {
      throw new Error(`${label} audits.${auditRef.id}.id must match its auditRef id`);
    }
  });
}

export async function assertLhciRunResults({
  outputDir,
  expectedOrigin,
  expectedReportCount,
  runStartedAtMs,
}) {
  if (!Number.isInteger(expectedReportCount) || expectedReportCount <= 0) {
    throw new Error('expectedReportCount must be a positive integer');
  }
  if (!Number.isFinite(runStartedAtMs) || runStartedAtMs <= 0) {
    throw new Error('runStartedAtMs must be a positive timestamp');
  }
  const normalizedOutputDir = path.resolve(outputDir);
  let outputDirStat;
  try {
    outputDirStat = await fs.lstat(normalizedOutputDir);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`Lighthouse run directory is missing: ${normalizedOutputDir}`);
    }
    throw error;
  }
  if (!outputDirStat.isDirectory() || outputDirStat.isSymbolicLink()) {
    throw new Error(
      `Lighthouse run directory must be a regular non-symlink directory: ${normalizedOutputDir}`,
    );
  }
  const canonicalOutputDir = await fs.realpath(normalizedOutputDir);
  const normalizedExpectedOrigin = normalizeHttpOrigin(
    expectedOrigin,
    'Lighthouse expected origin',
  );
  const manifestPath = path.join(normalizedOutputDir, 'manifest.json');
  await assertCanonicalFileContained(
    manifestPath,
    normalizedOutputDir,
    canonicalOutputDir,
    'Lighthouse run manifest',
  );
  let manifest;
  try {
    manifest = await readJsonFile(manifestPath, 'Lighthouse run manifest');
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Lighthouse run manifest is missing:')) {
      throw new Error(`Lighthouse run manifest is missing: ${manifestPath}`);
    }
    throw error;
  }
  if (!Array.isArray(manifest)) {
    throw new Error('Lighthouse run manifest must be an array');
  }
  if (manifest.length !== expectedReportCount) {
    throw new Error(
      `Lighthouse run manifest contains ${manifest.length} reports; expected ${expectedReportCount}`,
    );
  }

  const jsonPaths = new Set();
  const htmlPaths = new Set();
  for (const entry of manifest) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('Lighthouse run manifest entries must be objects');
    }
    const jsonPath = containedPath(normalizedOutputDir, entry.jsonPath, 'jsonPath');
    const htmlPath = containedPath(normalizedOutputDir, entry.htmlPath, 'htmlPath');
    if (jsonPaths.has(jsonPath)) {
      throw new Error(`Lighthouse run manifest repeats jsonPath: ${jsonPath}`);
    }
    if (htmlPaths.has(htmlPath)) {
      throw new Error(`Lighthouse run manifest repeats htmlPath: ${htmlPath}`);
    }
    await assertCanonicalFileContained(
      jsonPath,
      normalizedOutputDir,
      canonicalOutputDir,
      'Lighthouse JSON report',
    );
    await assertCanonicalFileContained(
      htmlPath,
      normalizedOutputDir,
      canonicalOutputDir,
      'Lighthouse HTML report',
    );
    jsonPaths.add(jsonPath);
    htmlPaths.add(htmlPath);
  }

  const directoryEntries = await fs.readdir(normalizedOutputDir, { withFileTypes: true });
  const directoryJsonPaths = new Set();
  for (const entry of directoryEntries) {
    if (entry.name === 'manifest.json' || !entry.name.endsWith('.json')) continue;
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new Error(`Lighthouse JSON report must be a regular non-symlink file: ${entry.name}`);
    }
    const directoryJsonPath = path.join(normalizedOutputDir, entry.name);
    await assertCanonicalFileContained(
      directoryJsonPath,
      normalizedOutputDir,
      canonicalOutputDir,
      'Lighthouse JSON report',
    );
    directoryJsonPaths.add(directoryJsonPath);
  }
  if (directoryJsonPaths.size !== expectedReportCount) {
    throw new Error(
      `Lighthouse run directory contains ${directoryJsonPaths.size} JSON reports; expected ${expectedReportCount}`,
    );
  }
  for (const jsonPath of jsonPaths) {
    if (!directoryJsonPaths.has(jsonPath)) {
      throw new Error(`Lighthouse manifest JSON report is not in the run directory: ${jsonPath}`);
    }
  }

  for (const jsonPath of jsonPaths) {
    const reportName = path.basename(jsonPath);
    const report = await readJsonFile(jsonPath, `Lighthouse report ${reportName}`);
    if (!report || typeof report !== 'object' || Array.isArray(report)) {
      throw new Error(`Lighthouse report ${reportName} must be an object`);
    }
    assertLhrStructure(report, `Lighthouse report ${reportName}`);
    const fetchTimeMs = Date.parse(report.fetchTime);
    if (!Number.isFinite(fetchTimeMs)) {
      throw new Error(`Lighthouse report ${reportName} fetchTime must be valid`);
    }
    if (fetchTimeMs < runStartedAtMs) {
      throw new Error(
        `Lighthouse report ${reportName} fetchTime predates the current run`,
      );
    }
    for (const field of ['requestedUrl', 'finalUrl', 'finalDisplayedUrl']) {
      assertFinalUrlOrigin(
        report[field],
        normalizedExpectedOrigin,
        `Lighthouse report ${reportName} ${field}`,
      );
    }
  }

  return { reportCount: jsonPaths.size };
}
