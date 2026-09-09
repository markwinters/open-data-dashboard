#!/usr/bin/env node
/**
 * Checks every dataset in the registry against the live RDW API.
 *
 * The registry records a resource identifier and the columns each panel depends
 * on. Both can drift: RDW republishes datasets under new identifiers and
 * occasionally renames a column. This script asks the live API for one row of
 * each dataset and reports, per dataset, whether the resource resolves and
 * which of the expected columns are actually present.
 *
 *   npm run verify:datasets
 *
 * Exit code 1 if a required dataset fails, so it can gate a deploy.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const registrySource = readFileSync(join(here, '..', 'src', 'data', 'datasets.ts'), 'utf8');

/**
 * The registry is TypeScript, and this script runs on bare node, so the entries
 * are read out of the source rather than imported. Keeping one source of truth
 * matters more here than avoiding the parse.
 */
function parseRegistry(source) {
  const datasets = [];
  const entryPattern =
    /(\w+):\s*\{\s*id:\s*'([^']+)',\s*name:\s*'([^']+)',[\s\S]*?confidence:\s*'([^']+)',\s*required:\s*(true|false),\s*fields:\s*\[([\s\S]*?)\],/g;
  let match;
  while ((match = entryPattern.exec(source)) !== null) {
    const [, key, id, name, confidence, required, fieldBlock] = match;
    // Field lists can carry comment lines (and an apostrophe inside one would
    // feed a naive all-text scan a bogus "field"), so only whole lines shaped
    // like string-list entries count as fields.
    const fields = fieldBlock
      .split('\n')
      .map((line) => line.trim().match(/^'([^']+)',?$/))
      .filter((m) => m !== null)
      .map((m) => m[1]);
    datasets.push({ key, id, name, confidence, required: required === 'true', fields });
  }
  return datasets;
}

const datasets = parseRegistry(registrySource);
if (datasets.length === 0) {
  console.error('Could not read any dataset from src/data/datasets.ts - has its shape changed?');
  process.exit(1);
}

const token = process.env.VITE_RDW_APP_TOKEN ?? process.env.RDW_APP_TOKEN;
const headers = { Accept: 'application/json', ...(token ? { 'X-App-Token': token } : {}) };

const GREEN = '\u001b[32m';
const RED = '\u001b[31m';
const YELLOW = '\u001b[33m';
const DIM = '\u001b[2m';
const RESET = '\u001b[0m';

let failed = 0;
let warned = 0;

console.log(`\nChecking ${datasets.length} RDW datasets against opendata.rdw.nl\n`);

for (const dataset of datasets) {
  const url = `https://opendata.rdw.nl/resource/${dataset.id}.json?$limit=1`;
  let status = 'FAIL';
  let detail = '';
  let missing = [];

  try {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      // A 403 usually means throttling or a proxy in front of this machine
      // refusing the host - neither says anything about the dataset id, so
      // do not let it be read as "the registry is wrong".
      detail =
        response.status === 403 || response.status === 429
          ? `HTTP ${response.status} - throttled, or outbound access to opendata.rdw.nl is blocked here. This says nothing about the dataset id.`
          : `HTTP ${response.status}`;
    } else {
      const rows = await response.json();
      const row = Array.isArray(rows) ? rows[0] : undefined;
      if (!row) {
        // A resource that resolves but returns nothing is not a failure - a
        // sparse dataset can legitimately answer an unfiltered limit-1 query
        // with no rows - but the columns cannot be checked from it.
        status = 'WARN';
        detail = 'resource resolves, but returned no rows to check columns against';
      } else {
        // Socrata omits null columns from a row, so a field missing here is
        // only a hint. The authoritative check is whether selecting it errors.
        const present = new Set(Object.keys(row));
        const suspects = dataset.fields.filter((field) => !present.has(field));
        if (suspects.length === 0) {
          status = 'OK';
        } else {
          const probe = await fetch(
            `https://opendata.rdw.nl/resource/${dataset.id}.json?$select=${encodeURIComponent(
              suspects.join(', '),
            )}&$limit=1`,
            { headers },
          );
          if (probe.ok) {
            status = 'OK';
            detail = `${suspects.length} column(s) null in the sampled row but valid`;
          } else {
            missing = suspects;
            status = 'FAIL';
            detail = `unknown column(s): ${suspects.join(', ')}`;
          }
        }
      }
    }
  } catch (error) {
    detail = error instanceof Error ? error.message : String(error);
  }

  const colour = status === 'OK' ? GREEN : status === 'WARN' ? YELLOW : RED;
  const flag = dataset.required ? 'required' : 'optional';
  console.log(
    `${colour}${status.padEnd(4)}${RESET} ${dataset.id.padEnd(10)} ${dataset.name.padEnd(46)} ` +
      `${DIM}${flag} · declared ${dataset.confidence}${RESET}`,
  );
  if (detail) console.log(`      ${DIM}${detail}${RESET}`);

  if (status === 'FAIL') {
    if (dataset.required) failed++;
    else warned++;
    if (missing.length > 0) {
      console.log(`      ${DIM}fix: update fields for "${dataset.key}" in src/data/datasets.ts${RESET}`);
    }
  }
  if (status === 'WARN') warned++;
}

console.log(
  `\n${failed === 0 ? GREEN : RED}${failed} required dataset(s) failing${RESET}, ` +
    `${warned} optional/unknown.\n`,
);

if (failed > 0) {
  console.log(
    'A failing required dataset means the dashboard cannot render its core panels.\n' +
      'Search opendata.rdw.nl for the dataset by name and update its id in src/data/datasets.ts.\n',
  );
}

process.exit(failed > 0 ? 1 : 0);
