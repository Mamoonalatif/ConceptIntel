import type { GeneratedContentItem } from '../services/api';

/**
 * Export helpers for generated content.
 *
 * Two formats, for two genuinely different jobs:
 *   JSON  - the exact payload, for re-importing, backing up, or moving a set between
 *           courses. Lossless.
 *   HTML  - a printable handout. Self-contained (styles inlined), so it survives being
 *           emailed or saved, and prints cleanly to PDF via the browser's own dialog
 *           rather than pulling in a PDF library for a page of text.
 */

export function slugify(text: string): string {
  return (text || 'content')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'content';
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Delayed so the navigation the click starts isn't cancelled by revoking too soon.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function downloadContentJson(item: GeneratedContentItem): void {
  const payload = {
    title: item.title,
    concept: item.concept_name,
    content_type: item.content_type,
    difficulty: item.difficulty,
    status: item.status,
    grounded_excerpts: item.grounded_excerpts,
    created_at: item.created_at,
    payload: item.payload,
  };
  triggerDownload(
    new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
    `${slugify(item.title)}.json`
  );
}

const escapeHtml = (s: unknown): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * Builds a standalone printable document.
 *
 * `withAnswers` decides whether the answer key is included - the same quiz is both a
 * worksheet to hand out and a marking sheet to keep, and the only difference is
 * whether the answers are on it.
 */
export function buildContentHtml(item: GeneratedContentItem, withAnswers = true): string {
  const p = item.payload || {};
  let body = '';

  if (item.content_type === 'flashcard') {
    const cards = (p.cards || []) as Array<{ front: string; back: string }>;
    body = `<table class="cards"><thead><tr><th style="width:45%">Term</th><th>Definition</th></tr></thead><tbody>${
      cards.map((c) => `<tr><td class="term">${escapeHtml(c.front)}</td><td>${withAnswers ? escapeHtml(c.back) : ''}</td></tr>`).join('')
    }</tbody></table>`;
  } else if (item.content_type === 'study_guide') {
    const g = p as any;
    const list = (title: string, items?: string[]) =>
      items?.length ? `<h2>${escapeHtml(title)}</h2><ul>${items.map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul>` : '';
    body = `
      <h2>Summary</h2><p>${escapeHtml(g.summary)}</p>
      ${list('Key points', g.key_points)}
      ${g.key_terms?.length ? `<h2>Key terms</h2><dl>${g.key_terms.map((t: any) => `<dt>${escapeHtml(t.term)}</dt><dd>${escapeHtml(t.definition)}</dd>`).join('')}</dl>` : ''}
      ${list('Formulae', g.formulae)}
      ${g.worked_example ? `<h2>Worked example</h2><pre>${escapeHtml(g.worked_example)}</pre>` : ''}
      ${list('Common mistakes', g.common_mistakes)}
      ${g.connections ? `<h2>How this connects</h2><p>${escapeHtml(g.connections)}</p>` : ''}`;
  } else {
    const qs = (p.questions || []) as Array<{ question: string; options: string[]; correct_index: number; explanation: string }>;
    body = `<ol class="questions">${qs.map((q) => `
      <li>
        <p class="q">${escapeHtml(q.question)}</p>
        <ol type="A" class="opts">${q.options.map((o, i) =>
          `<li class="${withAnswers && i === q.correct_index ? 'correct' : ''}">${escapeHtml(o)}</li>`
        ).join('')}</ol>
        ${withAnswers && q.explanation ? `<p class="exp">${escapeHtml(q.explanation)}</p>` : ''}
      </li>`).join('')}</ol>`;
  }

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${escapeHtml(item.title)}</title>
<style>
  :root { color-scheme: light; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
         max-width: 820px; margin: 2.5rem auto; padding: 0 1.5rem; color: #0f172a; line-height: 1.6; }
  header { border-bottom: 2px solid #0f766e; padding-bottom: .75rem; margin-bottom: 1.5rem; }
  h1 { font-size: 1.5rem; margin: 0 0 .25rem; color: #0f766e; }
  .meta { font-size: .8rem; color: #64748b; }
  h2 { font-size: 1rem; margin: 1.5rem 0 .5rem; color: #0f766e; }
  table.cards { width: 100%; border-collapse: collapse; }
  table.cards th { text-align: left; font-size: .75rem; text-transform: uppercase;
                   letter-spacing: .04em; color: #64748b; border-bottom: 1px solid #cbd5e1; padding: .5rem; }
  table.cards td { border-bottom: 1px solid #e2e8f0; padding: .6rem .5rem; vertical-align: top; font-size: .9rem; }
  td.term { font-weight: 600; }
  ol.questions > li { margin-bottom: 1.25rem; }
  .q { font-weight: 600; margin: 0 0 .4rem; }
  ol.opts li { margin: .15rem 0; font-size: .9rem; }
  ol.opts li.correct { font-weight: 700; color: #047857; }
  .exp { font-size: .8rem; color: #475569; font-style: italic; margin-top: .35rem; }
  dt { font-weight: 600; margin-top: .5rem; }
  dd { margin: 0 0 .25rem 1rem; font-size: .9rem; }
  pre { background: #f1f5f9; padding: .9rem; border-radius: 8px; white-space: pre-wrap;
        font-size: .85rem; font-family: ui-monospace, Menlo, Consolas, monospace; }
  footer { margin-top: 2.5rem; border-top: 1px solid #e2e8f0; padding-top: .75rem;
           font-size: .72rem; color: #94a3b8; }
  @media print { body { margin: 0; } @page { margin: 1.6cm; } }
</style></head>
<body>
  <header>
    <h1>${escapeHtml(item.title)}</h1>
    <p class="meta">${escapeHtml(item.concept_name)} &middot; ${escapeHtml(item.difficulty)}
      &middot; ${escapeHtml(item.content_type.replace('_', ' '))}
      ${withAnswers ? '' : '&middot; worksheet (no answers)'}</p>
  </header>
  ${body}
  <footer>Generated by ConceptIntel${item.grounded_excerpts ? ` &middot; grounded in ${item.grounded_excerpts} course-material excerpt(s)` : ''}.</footer>
</body></html>`;
}

export function downloadContentHtml(item: GeneratedContentItem, withAnswers = true): void {
  triggerDownload(
    new Blob([buildContentHtml(item, withAnswers)], { type: 'text/html;charset=utf-8' }),
    `${slugify(item.title)}${withAnswers ? '' : '-worksheet'}.html`
  );
}

/**
 * Opens the printable version in a new tab and triggers the print dialog, which is
 * how a teacher gets a PDF without this app shipping a PDF renderer.
 */
export function printContent(item: GeneratedContentItem, withAnswers = true): void {
  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(buildContentHtml(item, withAnswers));
  win.document.close();
  win.addEventListener('load', () => win.print());
}
