const path = require('node:path');
const { canonicalSource, installName, sourceMatches } = require('./config.cjs');

function issue(code, message) { return { code, message }; }
function sameSource(a, b, project) {
  return a != null && b != null && canonicalSource(a, project) === canonicalSource(b, project);
}
function occupies(row, name) {
  return installName(row.name) === installName(name) || Boolean(row.path && installName(path.basename(row.path)) === installName(name));
}
function buildPlan({ mode, selection, inventory, state, targets, selectionDigest, project }) {
  const result = { mode, selectionDigest, items: [], extras: [], problems: [...inventory.problems] };
  const selectedNames = new Set(selection.skills.flatMap(group => group.names.map(installName)));
  result.extras = inventory.items.filter(item => ![...selectedNames].some(name=>occupies(item,name)));
  const allTargets = targets.includes('all');
  for (const group of selection.skills) {
    for (const name of group.names) {
      const existing = (inventory.allItems || inventory.items).filter(row => occupies(row,name));
      const scopes = allTargets && mode === 'update'
        ? [...new Set(existing.map(row => row.target))] : targets;
      if (!scopes.length) scopes.push('all');
      for (const target of scopes) {
        const row = target === 'all' ? existing[0] : existing.find(row => row.target === target);
        const item = { source: group.source, name, target, why: group.why,
          observed: row ? 'present' : 'missing', action: mode === 'update' ? 'update' : 'install',
          evidence: [], problems: [], digest: row?.digest ?? null, realPath: row?.realPath ?? null };
        // Check every physical occurrence: the upstream installer may overwrite a shared canonical copy.
        for (const occurrence of existing) {
          if (occurrence.name !== name) item.problems.push(issue('NAME_CONFLICT', `${name}: installed name ${occurrence.name} uses the same directory identity`));
          if (!occurrence.source) item.problems.push(issue('SOURCE_UNKNOWN', `${name}: installed source is unknown`));
          else if (!sourceMatches(group.source, occurrence, project)) {
            item.problems.push(issue('SOURCE_CONFLICT', `${name}: requested ${group.source}, installed ${occurrence.source}`));
          }
          item.problems.push(...occurrence.problems);
        }
        if (!row) {
          if (mode === 'update') item.problems.push(issue('MISSING_SKILL', `${name}: initialize the missing skill before updating`));
          else if (existing.length) item.problems.push(issue('SHARED_IMPACT', `${name}: adding a target could overwrite existing shared content; resolve target placement explicitly`));
        } else {
          item.evidence.push(`installed source: ${row.source ?? 'unknown'}`);
          const baseline = state.entries.find(entry => entry.name === name && entry.target === row.target && sameSource(entry.source, group.source, project));
          if (mode !== 'update') {
            item.action = 'keep';
            item.observed = baseline ? baseline.digest === row.digest ? 'verified' : 'local-modified' : 'content-unverified';
            if (target === 'all' && mode !== 'status') item.problems.push(issue('ALL_TARGET_UNVERIFIED', `${name}: existing skills do not prove coverage for every supported agent; specify concrete targets`));
          } else {
            if (row.path && path.basename(row.path) !== installName(name)) item.problems.push(issue('LOCATION_CONFLICT', `${name}: installed directory does not match the upstream installation identity; resolve its placement before updating`));
            if (!baseline) item.problems.push(issue('BASELINE_UNKNOWN', `${name}: no verified installation baseline for ${target}`));
            else if (baseline.digest !== row.digest) item.problems.push(issue('LOCAL_MODIFIED', `${name}: local content changed; update refused`));
            const outside = (row.sharedTargets || []).filter(scope => !allTargets && !targets.includes(scope));
            if (outside.length) item.problems.push(issue('SHARED_IMPACT', `${name}: shared with ${outside.join(', ')}; include these targets explicitly to update`));
          }
        }
        if (item.problems.length) item.action = 'blocked';
        result.items.push(item);
      }
    }
  }
  return result;
}
function assertPlan(plan) {
  const problems = [...plan.problems, ...plan.items.flatMap(item => item.problems)];
  if (problems.length) throw new Error(problems.map(problem => `${problem.code}: ${problem.message}`).join('\n'));
}
module.exports = { buildPlan, assertPlan, sameSource };
