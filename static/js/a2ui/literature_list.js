/** The records a literature turn retrieved. */

import { html, css, nothing } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { A2uiController, A2uiLitElement } from '@a2ui/lit/v0_9';
import z from 'zod';

import { BLOCK_SETTLE, pubmedUrl } from './shared.js';

const _LITERATURE_STYLES = css`
  :host { display: block; }
  .stack { display: flex; flex-direction: column; gap: 8px; }
  .record { border: 1px solid rgba(17, 24, 39, 0.15); border-radius: 10px;
            padding: 10px 13px; }
  .record-title { font-size: 0.9rem; font-weight: 600; line-height: 1.35; }
  .record-title a { color: inherit; }
  .record-meta { font-size: 0.75rem; opacity: 0.75; margin-top: 4px; }
  /* The identifier is the one thing in the row that is always actionable: it is what
     a reader copies, quotes and searches with. */
  .record-pmid { font-size: 0.75rem; letter-spacing: 0.03em; opacity: 0.75;
                 margin-top: 6px; }
  .record-pmid a { color: inherit; }
  .note { font-size: 0.88rem; opacity: 0.85; }
  .degraded { font-size: 0.75rem; font-style: italic; opacity: 0.75; margin-top: 4px; }
`;

const LiteratureListApi = {
  name: 'LiteratureList',
  schema: z.object({
    articles: z.array(z.object({
      pmid: z.string(),
      title: z.string(),
      journal: z.string(),
      pub_date: z.string(),
      url: z.string(),
    })).default([]),
    note: z.string().default(''),
    degraded: z.boolean().default(false),
  }).strict(),
};

class LiteratureListElement extends A2uiLitElement {
  static styles = [_LITERATURE_STYLES, BLOCK_SETTLE];

  createController() {
    return new A2uiController(this, LiteratureListApi);
  }

  render() {
    const props = this.controller?.props;
    if (!props) return nothing;

    const articles = props.articles || [];
    // No records: the agent's own sentence says which of the two things that was —
    // matched nothing, or could not be searched. Not restated here, because a
    // second wording for the same fact is a second thing that can drift.
    if (articles.length === 0) {
      return html`
        <div class="note">${props.note}</div>
        ${props.degraded
          ? html`<div class="degraded">The search did not complete.</div>`
          : nothing}
      `;
    }

    return html`
      <div class="stack">
        ${articles.map((article) => html`
          <div class="record">
            <div class="record-title">
              ${article.url
                ? html`<a href=${article.url} target="_blank"
                          rel="noopener noreferrer">${article.title}</a>`
                : article.title}
            </div>
            ${article.journal || article.pub_date
              ? html`<div class="record-meta">${
                  [article.journal, article.pub_date].filter(Boolean).join(' · ')}</div>`
              : nothing}
            <div class="record-pmid">PMID <a href=${pubmedUrl(article.pmid)}
              target="_blank" rel="noopener noreferrer"
              >${article.pmid}</a></div>
          </div>
        `)}
      </div>
    `;
  }
}

export const LiteratureList = {
  ...LiteratureListApi, tagName: 'a2ui-literature-list',
};
customElements.define('a2ui-literature-list', LiteratureListElement);

// ---------------------------------------------------------------------------
// Comparative risk matrix

//
// This patient's estimate against the cohorts the search returned that someone has
// curated a rate for. The difference from the list beneath it is the question being
// answered: the list says what was retrieved, this says where she sits among it.
//
// The pinned row is first and is the only row that is not a peer — a reader who cannot
// tell the patient's row from a cohort's has been handed a table about strangers and
// told it is about her. The band words come from `bandLabel`, the same function the
// widget uses, so the estimate cannot print one way in the row and another in the bar.
//
// The rate column is a string, not a number, and stays one: "≈20%" and "20%" are
// different claims about the same paper, and a column that could hold only the second
// would have to round the first into a certainty the abstract did not state.

