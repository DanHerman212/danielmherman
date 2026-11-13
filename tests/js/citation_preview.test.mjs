/* What the citation card shows, decided before any DOM exists.

   The card printed the whole passage, and a PubMed abstract is a wall of text that runs
   off the bottom of the window. `citation_preview.js` decides what a glance contains; this
   file pins its decisions against the three abstract shapes the live console actually
   serves, plus the short passages that must NOT be shortened.

   The abstracts are real records, copied from E-utilities on 2026-11-13 and joined the way
   `services/mcp/tools/literature._abstract` joins them — `LABEL: text` per section, one
   space between. That join is what makes the shapes below testable rather than invented. */

import test from 'node:test';
import assert from 'node:assert/strict';

import { formatCitationPreview, PREVIEW_LIMITS } from '../../static/js/a2ui/citation_preview.js';

/** PMID 36031784: PURPOSE / MATERIALS AND METHODS / RESULTS / CONCLUSION. */
const STRUCTURED_COLONS = [
  'PURPOSE: With an increasing number of anterior cervical discectomy and fusion (ACDF)',
  'being conducted for degenerative cervical disc disease, there is a rising interest in',
  'the related quality of management and healthcare costs. Unplanned readmission after',
  'ACDF affects both the quality of management and medical expenses. This meta-analysis',
  'was performed to evaluate the risk factors of unplanned readmission after ACDF to',
  'improve the quality of management and prevent increase in healthcare costs.',
  'MATERIALS AND METHODS: We searched the databases of PubMed, EMBASE, Web of Science,',
  'and Cochrane Library to identify eligible studies using the searching terms,',
  '"readmission" and "ACDF." A total of 10 studies were included.',
  'RESULTS: Among the demographic risk factors, older age [weighted mean difference',
  '(WMD), 3.93; 95% confidence interval (CI), 2.30-5.56; p<0.001], male [odds ratio (OR),',
  '1.23; 95% CI, 1.10-1.36; p<0.001], and private insurance (OR, 0.34; 95% CI, 0.17-0.69;',
  'p<0.001) were significantly associated with unplanned readmission. Among patient',
  'characteristics, hypertension (HTN) (OR, 2.14; 95% CI, 1.41-3.25; p<0.001), diabetes',
  'mellitus (DM) (OR, 1.59; 95% CI, 1.20-2.11; p=0.001), coronary artery disease (CAD)',
  '(OR, 2.87; 95% CI, 2.13-3.86; p<0.001), American Society of Anesthesiologists (ASA)',
  'physical status grade >2 (OR, 2.13; 95% CI, 1.68-2.72; p<0.001), and anxiety and',
  'depression (OR, 1.39; 95% CI, 1.29-1.51; p<0.001) were significantly associated with',
  'unplanned readmission. Among the perioperative factors, pulmonary complications',
  '(OR, 22.52; 95% CI, 7.21-70.41; p<0.001) was significantly associated with unplanned',
  'readmission.',
  'CONCLUSION: Male, older age, HTN, DM, CAD, ASA grade >2, anxiety and depression,',
  'pulmonary complications were significantly associated with an increased occurrence of',
  'unplanned readmission after ACDF.',
].join(' ');

/** PMID 37559220: STUDY DESIGN / OBJECTIVE / SUMMARY OF BACKGROUND DATA / METHODS / RESULTS / CONCLUSION. */
const STRUCTURED_SIX_SECTIONS = [
  'STUDY DESIGN: Retrospective analysis.',
  'OBJECTIVE: To assess perioperative complication rates and readmission rates after',
  'ACDF in a patient population of advanced age.',
  'SUMMARY OF BACKGROUND DATA: Readmission rates after ACDF are important markers of',
  'surgical quality and, with recent shifts in reimbursement schedules, they are rapidly',
  'gaining weight in the determination of surgeon and hospital reimbursement.',
  'METHODS: Patients 18 years of age and older who underwent elective single-level ACDF',
  'were identified in the National Readmissions Database (NRD) and stratified into 4',
  'cohorts: 18-39 ("young"), 40-64 ("middle"), 65-74 ("senior"), and 75+ ("elderly")',
  'years of age. For each cohort, the perioperative complications, frequency of those',
  'complications, and number of patients with at least 1 readmission within 30 and 90',
  'days of discharge were analyzed.',
  'RESULTS: There were 1174 "elderly" patients in 2016, 1072 in 2017, and 1010 in 2018',
  'who underwent ACDF. Their rate of any complication was 8.95%, 11.00%, and 13.47%,',
  'respectively ( P <0.0001), with dysphagia and acute posthemorrhagic anemia being the',
  'most common across all 3 years. They experienced complications at a greater frequency',
  'than their younger counterparts (15.80%, P <0.0001; 16.98%, P <0.0001; 21.68%, P',
  '<0.0001).',
  'CONCLUSION: It has been well-established that advanced patient age brings greater risk',
  'of perioperative complications in ACDF surgery. What remains unsettled is the',
  'characterization of this age-complication relationship within specific age cohorts and',
  'how these complications inform patient hospital course.',
].join(' ');

/** PMID 28142261: no labels at all, so the headings are bare capitals in the prose. */
const BARE_HEADINGS = [
  'OBJECTIVE The goal of this study was to compare 30-day readmission and reoperation',
  'rates after single-level anterior cervical discectomy and fusion (ACDF) versus those',
  'after cervical disc replacement (CDR).',
  'METHODS The authors used the 2013-2014 American College of Surgeons National Surgical',
  'Quality Improvement Program database. Included were adult patients who underwent',
  'first-time single-level ACDF or CDR for cervical spondylosis or disc herniation.',
  'RESULTS A total of 6077 patients met the inclusion criteria; 5590 (92.0%) patients',
  'underwent single-level ACDF, and 487 (8.0%) patients underwent CDR. The readmission',
  'rates were 2.6% for ACDF and 0.4% for CDR (p = 0.003).',
  'CONCLUSIONS Patients who underwent single-level ACDF had a higher readmission rate',
  'than those who underwent single-level CDR in this study.',
].join(' ');

/** Balanced-paren invariant: no preview may end inside an open `(` or `[`. */
function assertBalanced(text) {
  const opens = (text.match(/\(/g) || []).length;
  const closes = (text.match(/\)/g) || []).length;
  const brackets = (text.match(/\[/g) || []).length;
  const bracketsClosed = (text.match(/\]/g) || []).length;
  // A clamp may legitimately end before a group closes only if the group never opened;
  // an unbalanced result means the cut fell inside it.
  assert.equal(brackets, bracketsClosed, `unbalanced [] in: ${text}`);
  if (opens !== closes) {
    assert.ok(text.endsWith('…'), `unbalanced () in a completed block: ${text}`);
  }
}

test('a colon-labelled abstract is boiled down to Results and Conclusion', () => {
  const preview = formatCitationPreview(STRUCTURED_COLONS);

  assert.equal(preview.layout, 'structured');
  assert.deepEqual(preview.blocks.map((block) => block.label), ['Results', 'Conclusion']);
  assert.equal(preview.disclosure, true, 'the sections it dropped are what the cue is for');
  // The setup and the methods are what the authors did, not what they found.
  assert.ok(!/PURPOSE|MATERIALS AND METHODS/.test(JSON.stringify(preview.blocks)));
  for (const block of preview.blocks) {
    assertBalanced(block.text);
    assert.ok(block.text.length <= PREVIEW_LIMITS.block, `${block.label} over budget`);
    assert.ok(block.text.length > 40, `${block.label} too short to be useful`);
  }
  const total = preview.blocks.reduce((sum, block) => sum + block.text.length, 0);
  assert.ok(total <= PREVIEW_LIMITS.total, `combined preview ${total} chars`);
});

test('a six-section abstract keeps its findings and drops the design', () => {
  const preview = formatCitationPreview(STRUCTURED_SIX_SECTIONS);

  assert.equal(preview.layout, 'structured');
  assert.deepEqual(preview.blocks.map((block) => block.label), ['Results', 'Conclusion']);
  assert.match(preview.blocks[0].text, /8\.95|1174|dysphagia/,
    'the quantitative lead of the Results is the part worth showing');
  assert.doesNotMatch(JSON.stringify(preview.blocks), /Retrospective analysis|NRD/);
});

test('bare capital headings are recognised without colons', () => {
  const preview = formatCitationPreview(BARE_HEADINGS);

  assert.equal(preview.layout, 'structured');
  assert.deepEqual(preview.blocks.map((block) => block.label), ['Results', 'Conclusion']);
  assert.match(preview.blocks[0].text, /6077|2\.6%/);
  assert.doesNotMatch(JSON.stringify(preview.blocks), /The goal of this study/);
  assert.match(preview.blocks[1].text, /CDR/);
});

test('the Results block keeps whole statistics', () => {
  const preview = formatCitationPreview(STRUCTURED_COLONS);
  const results = preview.blocks[0].text;

  assertBalanced(results);
  // Never a half-written interval: an excerpt that stops inside `(OR, 2.14; 95% CI,`
  // reads as a complete interval that is not one.
  assert.doesNotMatch(results, /CI,\s*[\d.]*-?$/);
});

test('a short passage is shown verbatim and carries no disclosure cue', () => {
  const short = 'Readmission rates were 2.6% for ACDF and 0.4% for CDR (p = 0.003).';

  const preview = formatCitationPreview(short);

  assert.equal(preview.layout, 'text');
  assert.equal(preview.blocks[0].text, short);
  assert.equal(preview.disclosure, false);
});

test('a one-word note is shown verbatim', () => {
  const preview = formatCitationPreview('None.');

  assert.equal(preview.layout, 'text');
  assert.equal(preview.blocks[0].text, 'None.');
  assert.equal(preview.disclosure, false);
});

test('a long narrative note stops at a sentence boundary', () => {
  const note = [
    'Brief hospital course: The patient was admitted with increasing shortness of breath',
    'and cough productive of sputum. She was started on intravenous steroids and',
    'bronchodilators with gradual improvement. Antibiotics were continued for five days',
    'and she remained afebrile throughout. Pulmonary function testing on day three showed',
    'an FEV1 of 1.2 litres, improved from 0.9 on admission. She was discharged home on a',
    'prednisone taper with follow-up in the pulmonary clinic arranged for two weeks.',
    'Smoking cessation counselling was provided and she agreed to a quit date.',
  ].join(' ');

  const preview = formatCitationPreview(note);

  assert.equal(preview.layout, 'text');
  assert.equal(preview.disclosure, true);
  const text = preview.blocks[0].text;
  assert.ok(text.length <= PREVIEW_LIMITS.clamp, `${text.length} chars`);
  assert.ok(text.length >= PREVIEW_LIMITS.short - 40, 'stopped too early to be a preview');
  assert.match(text, /…$/, 'a clamped passage ends with an ellipsis');
  assert.match(text, /[.!?]…$/, 'and the last full stop is a sentence end, not a cut');
});

test('an inline numbered clinical list becomes one line per item', () => {
  const note = [
    '1. Anterior cervical discectomy and fusion (ACDF) C5-C6. 2. Cervical spondylosis',
    'with myelopathy. 3. Degenerative disc disease C4-C5 and C6-C7. 4. Hypertension.',
    '5. Allograft.',
  ].join(' ');

  const preview = formatCitationPreview(note);

  assert.equal(preview.layout, 'list');
  assert.equal(preview.items.length, 4);
  assert.equal(preview.moreCount, 1, 'the fifth item is behind the References list');
  assert.equal(preview.items[0], 'Anterior cervical discectomy and fusion (ACDF) C5-C6');
  assert.equal(preview.disclosure, true);
});

test('decimals and years are never mistaken for list markers', () => {
  const prose = 'Readmission was 2.6% for ACDF and 0.4% for CDR (p = 0.003). '
    + '2022. Lee YJ reported the same. 7.5% of the cohort was lost to follow-up.';

  const preview = formatCitationPreview(prose);

  assert.equal(preview.layout, 'text', 'this is prose, not a list');
  assert.equal(preview.disclosure, false);
  assert.match(preview.blocks[0].text, /2\.6%/);
  assert.match(preview.blocks[0].text, /2022\. Lee YJ/);
});

test('an empty or whitespace-only excerpt renders nothing', () => {
  for (const value of ['', '   ', null, undefined]) {
    const preview = formatCitationPreview(value);
    assert.deepEqual(preview.blocks, []);
    assert.equal(preview.disclosure, false);
  }
});

test('whitespace is normalised but the text itself is untouched', () => {
  const messy = 'None.\n\n  No complications.   ';

  const preview = formatCitationPreview(messy);

  assert.equal(preview.blocks[0].text, 'None. No complications.');
});
