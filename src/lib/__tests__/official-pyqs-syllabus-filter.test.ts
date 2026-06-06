import test from 'node:test';
import assert from 'node:assert/strict';

import { __testUtils, getOfficialSubjectPyqShells } from '../official-pyqs';

const { meaningfulTopicTerms } = __testUtils;

const GS1_WOMEN_POPULATION_POVERTY_URBANIZATION_LABEL = 'Role of women and women’s organization, population and associated issues, poverty and developmental issues, urbanization, their problems and their remedies.';
const GS1_WOMEN_POPULATION_POVERTY_URBANIZATION_NODE_ID = 'gs1:topic:society-role-of-women-and-women-s-organization-population-and-associated-issues-poverty-and-developmental-issues-urbaniz';
const UNRELATED_ISLAND_STATES_PYQ_ID = 'official_gs1_2025_4';
const CORE_TOPIC_PYQ_IDS = [
  'official_gs1_2025_8',
  'official_gs1_2015_9',
  'official_gs1_2024_8',
  'official_gs1_2021_18',
  'official_gs1_2019_9',
  'official_gs1_2023_18',
];

test('GS1 selected-topic filter includes core women/population/poverty/urbanization PYQs and excludes unrelated climate/island-states PYQ', () => {
  const ids = getOfficialSubjectPyqShells('gs1', '', 80, GS1_WOMEN_POPULATION_POVERTY_URBANIZATION_LABEL).map((row) => row.id);

  for (const id of CORE_TOPIC_PYQ_IDS) {
    assert.ok(ids.includes(id), `expected ${id} to survive the selected-topic filter`);
  }

  assert.ok(!ids.includes(UNRELATED_ISLAND_STATES_PYQ_ID));
});

test('selected-topic mode orders the strongest GS1 topic matches ahead of weaker matches', () => {
  const firstSixIds = getOfficialSubjectPyqShells('gs1', '', 6, GS1_WOMEN_POPULATION_POVERTY_URBANIZATION_LABEL)
    .map((row) => row.id);

  assert.deepEqual(firstSixIds, [
    'official_gs1_2025_8',
    'official_gs1_2015_9',
    'official_gs1_2024_7',
    'official_gs1_2024_8',
    'official_gs1_2023_9',
    'official_gs1_2023_18',
  ]);
});

test('stop-word-heavy syllabus strings still keep the meaningful topic terms while dropping generic filler tokens', () => {
  const terms = meaningfulTopicTerms(`GS1 topic section part and the of ${GS1_WOMEN_POPULATION_POVERTY_URBANIZATION_LABEL}`);

  for (const term of ['role', 'women', 'organization', 'population', 'poverty', 'urbanization']) {
    assert.ok(terms.includes(term), `expected ${term} to remain searchable`);
  }

  for (const filler of ['topic', 'section', 'part', 'and', 'the', 'of']) {
    assert.ok(!terms.includes(filler), `expected ${filler} to be ignored`);
  }
});

test('node-id form and label form both retain the core topic hits and both exclude the island-states outlier', () => {
  const labelIds = getOfficialSubjectPyqShells('gs1', '', 40, GS1_WOMEN_POPULATION_POVERTY_URBANIZATION_LABEL).map((row) => row.id);
  const nodeIds = getOfficialSubjectPyqShells('gs1', '', 40, GS1_WOMEN_POPULATION_POVERTY_URBANIZATION_NODE_ID).map((row) => row.id);

  for (const id of CORE_TOPIC_PYQ_IDS) {
    assert.ok(labelIds.includes(id), `expected label filter to include ${id}`);
    assert.ok(nodeIds.includes(id), `expected node-id filter to include ${id}`);
  }

  assert.ok(!labelIds.includes(UNRELATED_ISLAND_STATES_PYQ_ID));
  assert.ok(!nodeIds.includes(UNRELATED_ISLAND_STATES_PYQ_ID));
});

test('omitting the syllabus filter keeps the default GS1 ordering unchanged', () => {
  const withoutSyllabus = getOfficialSubjectPyqShells('gs1', '', 12).map((row) => row.id);
  const emptySyllabus = getOfficialSubjectPyqShells('gs1', '', 12, '').map((row) => row.id);
  const whitespaceSyllabus = getOfficialSubjectPyqShells('gs1', '', 12, '   ').map((row) => row.id);

  assert.deepEqual(emptySyllabus, withoutSyllabus);
  assert.deepEqual(whitespaceSyllabus, withoutSyllabus);
  assert.equal(withoutSyllabus[0], 'official_gs1_2025_1');
  assert.equal(withoutSyllabus[3], 'official_gs1_2025_4');
});
