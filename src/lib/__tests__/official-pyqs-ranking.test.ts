import test from 'node:test';
import assert from 'node:assert/strict';

import { __testUtils, type OfficialRow } from '../official-pyqs';

const { compareOfficialRowSearchResults, groupRelevantQuestions, rankOfficialRow } = __testUtils;

test('official top-level ranking prefers exact question-text hits over syllabus-only hits before year', () => {
  const query = 'climate change';
  const terms = ['climate', 'change'];

  const exactQuestion: OfficialRow = {
    id: 'q_exact',
    subjectKey: 'gs3',
    question: 'How does climate change affect agriculture in India?',
    paper: 'GS-3',
    category: 'GS 3',
    year: 2020,
    marks: 10,
    syllabusTags: ['Environment'],
    keywords: ['agriculture'],
  };

  const syllabusOnly: OfficialRow = {
    id: 'q_syllabus',
    subjectKey: 'gs3',
    question: 'Discuss irrigation reforms in India.',
    paper: 'GS-3',
    category: 'GS 3',
    year: 2024,
    marks: 10,
    syllabusTags: ['Climate change adaptation'],
    keywords: ['resilience change'],
  };

  const ranked = [syllabusOnly, exactQuestion]
    .map((row) => ({ row, rank: rankOfficialRow(row, terms, query) }))
    .sort(compareOfficialRowSearchResults)
    .map((entry) => entry.row.id);

  assert.deepEqual(ranked, ['q_exact', 'q_syllabus']);
});

test('grouped relevant questions rank by best link while keeping copy sort inside each group', () => {
  const links: Parameters<typeof groupRelevantQuestions>[0] = [
    {
      topperAnswerId: 'copy_topic',
      cardId: 'card_topic',
      matchType: 'topic-match',
      matchConfidence: 0.99,
      extractedQuestion: 'Topic grouped question',
      topperName: 'Topper Topic',
      rank: 1,
      year: 2024,
      institute: 'X',
      sourceAvailable: true,
      sourceStatus: 'available',
      pageNormalized: 2,
      pageStatus: 'valid',
      summary: 'A sufficiently detailed summary that is available and comfortably exceeds the minimum length requirement for display.',
      summaryStatus: 'available',
      valueAdds: [],
    },
    {
      topperAnswerId: 'copy_direct_no_pdf',
      cardId: 'card_direct',
      matchType: 'direct',
      matchConfidence: 0.7,
      extractedQuestion: 'Direct grouped question',
      topperName: 'Topper Direct A',
      rank: 5,
      year: 2021,
      institute: 'Y',
      sourceAvailable: false,
      sourceStatus: 'missing',
      pageNormalized: null,
      pageStatus: 'missing',
      summary: 'A sufficiently detailed summary that is available and comfortably exceeds the minimum length requirement for display.',
      summaryStatus: 'available',
      valueAdds: [],
    },
    {
      topperAnswerId: 'copy_direct_pdf',
      cardId: 'card_direct',
      matchType: 'direct',
      matchConfidence: 0.6,
      extractedQuestion: 'Direct grouped question',
      topperName: 'Topper Direct B',
      rank: 9,
      year: 2020,
      institute: 'Y',
      sourceAvailable: true,
      sourceStatus: 'available',
      pageNormalized: 4,
      pageStatus: 'valid',
      summary: 'A sufficiently detailed summary that is available and comfortably exceeds the minimum length requirement for display.',
      summaryStatus: 'available',
      valueAdds: [],
    },
  ];
  const grouped = groupRelevantQuestions(links);

  assert.equal(grouped[0]?.question, 'Direct grouped question');
  assert.equal(grouped[0]?.matchType, 'direct');
  assert.equal(grouped[0]?.matchConfidence, 0.7);
  assert.deepEqual(grouped[0]?.topperCopies.map((copy) => copy.answerId), ['copy_direct_pdf', 'copy_direct_no_pdf']);
  assert.equal(grouped[1]?.question, 'Topic grouped question');
});
