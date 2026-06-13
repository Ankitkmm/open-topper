import test from 'node:test';
import assert from 'node:assert/strict';

import { __testUtils, getOfficialSubjectPyqShells, type OfficialRow } from '../official-pyqs';
import { normalizeEssayPromptForMatch } from '../essay-normalization';

const {
  cleanOptionalFallbackQuestionText,
  extractMatchedEssayPrompt,
  filterPublishableLinksForRow,
  groupRelevantQuestions,
  isOptionalOfficialQuestionText,
  loadOfficialRows,
  parseOptionalPaperNumber,
} = __testUtils;

type OfficialAnswerLinkForTest = Parameters<typeof filterPublishableLinksForRow>[1][number];

const EXPECTED_OPTIONAL_SUBJECTS = [
  'geography',
  'sociology',
  'psir',
  'public-administration',
  'anthropology',
  'history',
] as const;

const OPTIONAL_OFFICIAL_ROW_FLOORS = {
  geography: 90,
  sociology: 90,
  psir: 55,
  'public-administration': 85,
  anthropology: 60,
  history: 90,
} as const;

test('optional official source files expose authoritative subject-scoped shells instead of workspace fallback rows', () => {
  const rows = loadOfficialRows();

  for (const subjectKey of EXPECTED_OPTIONAL_SUBJECTS) {
    const subjectRows = rows.filter((row) => row.subjectKey === subjectKey);
    const officialRows = subjectRows.filter((row) => row.sourceKind === 'optional-official');
    const fallbackRows = subjectRows.filter((row) => row.sourceKind === 'workspace-optional-fallback');
    const shells = getOfficialSubjectPyqShells(subjectKey, '', 8);

    assert.ok(officialRows.length >= OPTIONAL_OFFICIAL_ROW_FLOORS[subjectKey], `expected ${subjectKey} to have authoritative optional PYQs`);
    assert.equal(fallbackRows.length, 0, `expected ${subjectKey} to suppress workspace fallback rows once official source rows exist`);
    assert.ok(
      officialRows.every((row) => !JSON.stringify({ source: row.source, question: row.question }).match(/upsc\.gov\.in|\/Users\/|\/Volumes\/|extracted_data/i)),
      `expected ${subjectKey} optional source rows not to expose source URLs, local paths, or extraction roots`,
    );
    assert.ok(shells.length > 0, `expected ${subjectKey} to have official PYQ shells`);
    assert.ok(shells.every((shell) => shell.subjectKey === subjectKey), `expected ${subjectKey} shells to remain subject-scoped`);
    assert.ok(shells.every((shell) => !shell.id.startsWith('pyq_gs')), `expected ${subjectKey} shells not to expose legacy GS workspace IDs`);
    assert.ok(shells.every((shell) => !JSON.stringify(shell).includes('upsc.gov.in')), `expected ${subjectKey} public shells not to leak UPSC source URLs`);
    assert.ok(shells.every((shell) => !JSON.stringify(shell).includes('/Users/')), `expected ${subjectKey} public shells not to leak local paths`);
  }
});

test('optional official parser accepts roman and numeric paper labels', () => {
  assert.equal(parseOptionalPaperNumber('Paper I'), 1);
  assert.equal(parseOptionalPaperNumber('Paper - II'), 2);
  assert.equal(parseOptionalPaperNumber('Paper 1'), 1);
  assert.equal(parseOptionalPaperNumber('P2'), 2);
});

test('optional official question text gate rejects notes while accepting real PYQ-style demands', () => {
  assert.equal(isOptionalOfficialQuestionText('Discuss the role of kinship in tribal social organization. (20 marks)'), true);
  assert.equal(isOptionalOfficialQuestionText('Q.3(b): Examine Weberian theory of bureaucracy in the context of modern public administration.'), true);

  assert.equal(isOptionalOfficialQuestionText('Anthro Society'), false);
  assert.equal(isOptionalOfficialQuestionText('page 12'), false);
  assert.equal(isOptionalOfficialQuestionText('Introduction -> write about the thinker and add diagram'), false);
});

test('essay prompt normalization is shared for suffixes, quotes, and cannot/can not parity', () => {
  assert.equal(
    normalizeEssayPromptForMatch('Technology cannot replace manpower.'),
    normalizeEssayPromptForMatch('“Technology can not replace manpower.” (CSE 2023, PYQ)'),
  );
  assert.notEqual(
    normalizeEssayPromptForMatch('Technology cannot replace manpower.'),
    normalizeEssayPromptForMatch('Technology as the silent factor in international relations.'),
  );
});

test('optional fallback cleanup removes visible extraction artifacts without rewriting content', () => {
  assert.equal(
    cleanOptionalFallbackQuestionText('“QQue: Discuss the role of kinship in tribal social organization. ()”'),
    'Discuss the role of kinship in tribal social organization.',
  );
  assert.equal(
    cleanOptionalFallbackQuestionText('Q Q5 Explain Weberian bureaucracy.'),
    'Q5 Explain Weberian bureaucracy.',
  );
});

test('essay prompt extraction requires exact or near-exact prompt match and blocks generic topic false positives', () => {
  assert.equal(
    extractMatchedEssayPrompt('The doubter is a true man of science.', 'Art is I; science is We.'),
    '',
  );
  assert.equal(
    extractMatchedEssayPrompt('Contentment is natural wealth, luxury is artificial poverty.', 'The opposite of poverty is not wealth.'),
    '',
  );
  assert.equal(
    extractMatchedEssayPrompt('Technology cannot replace manpower.', 'Technology as the silent factor in international relations.'),
    '',
  );
  assert.equal(
    extractMatchedEssayPrompt('Culture is what we are, civilisation is what we have.', 'The culture of tourism in India.'),
    '',
  );

  assert.equal(
    extractMatchedEssayPrompt(
      'The doubter is a true man of science.',
      'Q.1 The doubter is a true man of science. Q.2 Art is I; science is We.',
    ),
    'The doubter is a true man of science.',
  );
});

test('essay links without an essay subject signal or exact prompt are not publishable', () => {
  const row: OfficialRow = {
    id: 'official_essay_test',
    subjectKey: 'essay',
    question: 'The doubter is a true man of science.',
    paper: 'Essay',
    category: 'Essay',
    year: 2024,
    marks: null,
    syllabusTags: ['Essay'],
    keywords: ['Essay'],
  };

  const baseLink: OfficialAnswerLinkForTest = {
    officialQuestionId: row.id,
    topperAnswerId: 'ans_test',
    cardId: 'card_test',
    matchType: 'loose-topic-match',
    matchConfidence: 0.99,
    matchReason: 'shared science token',
    extractedQuestion: 'Art is I; science is We.',
    paper: 'Essay',
    category: 'Essay',
    syllabusTags: ['Essay'],
    keywords: ['science'],
    topperName: 'Test Topper',
    rank: null,
    year: null,
    institute: null,
    sourceAvailable: true,
    sourceStatus: 'available',
    pageNormalized: 1,
    pageStatus: 'valid',
    summary: 'A sufficiently detailed summary that is available and comfortably exceeds the minimum length requirement for display.',
    summaryStatus: 'available',
    valueAdds: [],
  };

  assert.equal(filterPublishableLinksForRow(row, [baseLink]).length, 0);
  assert.equal(filterPublishableLinksForRow(row, [{
    ...baseLink,
    matchType: 'direct',
    matchConfidence: 1,
    extractedQuestion: 'Q.1 The doubter is a true man of science. Q.2 Art is I; science is We.',
  }]).length, 1);
});

test('grouped topper copies normalize non-person source labels to the public fallback and never leak raw labels', () => {
  const baseLink: OfficialAnswerLinkForTest = {
    officialQuestionId: 'official_geography_test',
    topperAnswerId: 'ans_0000000000000001',
    cardId: 'card_geo',
    matchType: 'direct',
    matchConfidence: 1,
    matchReason: 'direct',
    extractedQuestion: 'Discuss the geomorphic evolution of the peninsular plateau.',
    paper: 'Geography',
    category: 'Geography',
    syllabusTags: ['Geomorphology'],
    keywords: ['Geomorphology'],
    topperName: 'Test Topper',
    rank: null,
    year: null,
    institute: null,
    sourceAvailable: true,
    sourceStatus: 'available',
    pageNormalized: 1,
    pageStatus: 'valid',
    summary: '',
    summaryStatus: 'missing',
    valueAdds: [],
  };

  const badLabels = [
    'Pub Admn',
    'Copies',
    'TSM SOC NICE IAS',
    'Geomorphology Handwritten Notes',
    'Eb Aa Cd',
    'Anonymous topper',
    'FLT',
  ];

  const links = badLabels.map((label, index) => ({
    ...baseLink,
    topperAnswerId: `ans_00000000000000${(index + 10).toString(16).padStart(2, '0')}`,
    topperName: label,
  }));

  const groups = groupRelevantQuestions(links);
  const copies = groups.flatMap((group) => group.topperCopies);
  assert.equal(copies.length, badLabels.length);

  for (const copy of copies) {
    assert.equal(copy.topperName, 'Topper copy', `expected non-person label to render as the public fallback, got "${copy.topperName}"`);
    assert.equal(copy.nameStatus, 'anonymous', 'expected suppressed names to report anonymous nameStatus');
  }

  // A real person name is preserved and marked as a resolved (filename) name.
  const realGroups = groupRelevantQuestions([{ ...baseLink, topperName: 'PSIR SANJEEV KUMAR' }]);
  const realCopy = realGroups[0]?.topperCopies[0];
  assert.equal(realCopy?.topperName, 'Sanjeev Kumar');
  assert.equal(realCopy?.nameStatus, 'filename');
});
