// Knowledge-graph export ("soft form" download).
//
// Rather than screenshotting the live React Flow canvas (which would need an extra
// DOM-rasterizing dependency and would only capture whatever slice is currently
// scrolled into view), this rebuilds the whole graph as a standalone SVG from the
// same node positions/edges React Flow is already laying out. That means the export
// always contains EVERY concept - even on a 200-node graph the user can only see a
// corner of - and stays crisp at any zoom because it's vector, not pixels.
//
// From that one SVG string we derive all three formats:
//   .svg  - the string itself
//   .png  - SVG -> <img> -> <canvas> -> blob, at 2x for a sharp raster
//   .pdf  - printed through a hidden iframe, so the browser's own "Save as PDF"
//           handles the PDF writing and we don't need a jsPDF-style dependency.

export interface ExportNode {
  id: string;
  x: number;
  y: number;
  name: string;
  difficulty: string;
}

export interface ExportEdge {
  source: string;
  target: string;
}

// Must match the on-canvas node box in KnowledgeGraph.tsx (w-28 h-28 = 112px).
const NODE_SIZE = 112;
const PADDING = 70;
// Title / subtitle / legend each get their own line so a long course name can
// never run into the legend on a narrow (few-concept) graph.
const HEADER_HEIGHT = 116;
const MIN_WIDTH = 720;
const FOOTER_HEIGHT = 44;

// Same emerald/amber/rose family as getDifficultyStyles(), resolved to literal hex -
// an exported file can't reach Tailwind's stylesheet, so the classes are no help here.
const DIFFICULTY_COLORS: Record<string, { fill: string; stroke: string; text: string }> = {
  easy: { fill: '#6ee7b7', stroke: '#10b981', text: '#022c22' },
  medium: { fill: '#fcd34d', stroke: '#f59e0b', text: '#451a03' },
  hard: { fill: '#fda4af', stroke: '#f43f5e', text: '#4c0519' },
};

const colorsFor = (difficulty: string) =>
  DIFFICULTY_COLORS[difficulty?.toLowerCase()] ?? DIFFICULTY_COLORS.medium;

const escapeXml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

/** Greedy word wrap so a long concept name fits inside the circle instead of
 *  overflowing it - capped at 3 lines, with the last line ellipsised. A word that
 *  is on its own longer than one line (e.g. "Electromagnetic") is hyphenated across
 *  lines rather than truncated, so its tail isn't silently dropped. */
function wrapLabel(name: string, maxChars = 13, maxLines = 3): string[] {
  const lines: string[] = [];
  let current = '';
  const flush = () => { if (current) { lines.push(current); current = ''; } };

  for (const word of name.split(/\s+/).filter(Boolean)) {
    if (word.length > maxChars) {
      flush();
      let rest = word;
      while (rest.length > maxChars) {
        lines.push(`${rest.slice(0, maxChars - 1)}-`);
        rest = rest.slice(maxChars - 1);
      }
      current = rest;
      continue;
    }
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) current = candidate;
    else { flush(); current = word; }
  }
  flush();

  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1].replace(/-$/, '').slice(0, maxChars - 1)}…`;
    return kept;
  }
  return lines.length ? lines : [name];
}

export function buildGraphSvg(
  nodes: ExportNode[],
  edges: ExportEdge[],
  courseName: string,
  exportedOn: string,
): string {
  if (nodes.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200"><text x="300" y="100" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#64748b">No concepts in this graph yet.</text></svg>`;
  }

  const minX = Math.min(...nodes.map(n => n.x));
  const minY = Math.min(...nodes.map(n => n.y));
  const maxX = Math.max(...nodes.map(n => n.x)) + NODE_SIZE;
  const maxY = Math.max(...nodes.map(n => n.y)) + NODE_SIZE;

  const graphWidth = maxX - minX + PADDING * 2;
  const width = Math.max(MIN_WIDTH, graphWidth);
  const height = maxY - minY + PADDING * 2 + HEADER_HEIGHT + FOOTER_HEIGHT;

  // Canvas coords -> export coords (shift the graph below the title band, and
  // re-centre it if the header forced the page wider than the graph itself).
  const centeringOffset = (width - graphWidth) / 2;
  const tx = (x: number) => x - minX + PADDING + centeringOffset;
  const ty = (y: number) => y - minY + PADDING + HEADER_HEIGHT;

  const positions = new Map(nodes.map(n => [n.id, n]));

  // Same convention as the live canvas: the line runs from the prerequisite's
  // bottom edge down to the dependent concept's top edge, and the arrowhead sits
  // at the START of the line pointing back up at the prerequisite.
  const edgeMarkup = edges
    .map(e => {
      const source = positions.get(e.source);
      const target = positions.get(e.target);
      if (!source || !target) return '';
      const x1 = tx(source.x + NODE_SIZE / 2);
      const y1 = ty(source.y + NODE_SIZE);
      const x2 = tx(target.x + NODE_SIZE / 2);
      const y2 = ty(target.y);
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#64748b" stroke-width="1.5" marker-start="url(#prereq-arrow)" />`;
    })
    .join('\n    ');

  const nodeMarkup = nodes
    .map(n => {
      const c = colorsFor(n.difficulty);
      const cx = tx(n.x + NODE_SIZE / 2);
      const cy = ty(n.y + NODE_SIZE / 2);
      const lines = wrapLabel(n.name);
      const startY = cy - ((lines.length - 1) * 12) / 2 + 4;
      const text = lines
        .map((line, i) => `<tspan x="${cx}" y="${startY + i * 12}">${escapeXml(line)}</tspan>`)
        .join('');
      return `<g>
      <circle cx="${cx}" cy="${cy}" r="${NODE_SIZE / 2 - 2}" fill="${c.fill}" stroke="${c.stroke}" stroke-width="4" />
      <text text-anchor="middle" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="10.5" font-weight="700" fill="${c.text}">${text}</text>
    </g>`;
    })
    .join('\n    ');

  const counts = {
    easy: nodes.filter(n => n.difficulty?.toLowerCase() === 'easy').length,
    medium: nodes.filter(n => n.difficulty?.toLowerCase() === 'medium').length,
    hard: nodes.filter(n => n.difficulty?.toLowerCase() === 'hard').length,
  };

  const legend = (['easy', 'medium', 'hard'] as const)
    .map((key, i) => {
      const c = colorsFor(key);
      const x = PADDING + 6 + i * 100;
      return `<circle cx="${x}" cy="86" r="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="2" />
    <text x="${x + 12}" y="90" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="11" fill="#475569">${key[0].toUpperCase()}${key.slice(1)} (${counts[key]})</text>`;
    })
    .join('\n    ');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <marker id="prereq-arrow" markerWidth="10" markerHeight="10" refX="0" refY="5" orient="auto" markerUnits="strokeWidth">
      <path d="M 10 0 L 0 5 L 10 10 z" fill="#64748b" />
    </marker>
  </defs>
  <rect width="100%" height="100%" fill="#ffffff" />
  <text x="${PADDING}" y="42" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="20" font-weight="700" fill="#0f172a">${escapeXml(courseName)} — Concept Graph</text>
  <text x="${PADDING}" y="64" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="11" fill="#64748b">${nodes.length} concepts · ${edges.length} prerequisite links · exported ${escapeXml(exportedOn)}</text>
  ${legend}
  <line x1="${PADDING}" y1="${HEADER_HEIGHT - 12}" x2="${width - PADDING}" y2="${HEADER_HEIGHT - 12}" stroke="#dde3f0" stroke-width="1" />
  <g>
    ${edgeMarkup}
  </g>
  <g>
    ${nodeMarkup}
  </g>
  <text x="${PADDING}" y="${height - 16}" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="10" fill="#94a3b8">An arrow points at the concept you must learn first (the prerequisite). Generated by ConceptIntel.</text>
</svg>`;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function downloadSvg(svg: string, filename: string) {
  triggerDownload(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), filename);
}

/** Rasterizes the SVG at 2x through an off-screen canvas. Uses a data: URL rather
 *  than an object URL because Chrome taints the canvas for blob-backed SVG images,
 *  which would make toBlob() throw a SecurityError. */
export function downloadPng(svg: string, filename: string, scale = 2): Promise<void> {
  return new Promise((resolve, reject) => {
    const widthMatch = svg.match(/width="(\d+(?:\.\d+)?)"/);
    const heightMatch = svg.match(/height="(\d+(?:\.\d+)?)"/);
    const width = widthMatch ? parseFloat(widthMatch[1]) : 1200;
    const height = heightMatch ? parseFloat(heightMatch[1]) : 800;

    // Browsers cap a canvas at ~16k px per side; a course with hundreds of
    // concepts can exceed that at 2x, and an oversized canvas silently renders
    // blank rather than erroring. Step the scale down instead of failing.
    const MAX_CANVAS_PX = 16000;
    const safeScale = Math.min(scale, MAX_CANVAS_PX / width, MAX_CANVAS_PX / height);

    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(width * safeScale);
      canvas.height = Math.round(height * safeScale);
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Canvas is unavailable in this browser.'));
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(blob => {
        if (!blob) return reject(new Error('Could not encode the PNG.'));
        triggerDownload(blob, filename);
        resolve();
      }, 'image/png');
    };
    image.onerror = () => reject(new Error('Could not render the graph image.'));
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

/** Opens the browser print dialog on a hidden iframe containing just the graph, so
 *  "Save as PDF" produces a clean one-page vector PDF. An iframe (not window.open)
 *  keeps this out of the way of popup blockers. */
export function printGraphAsPdf(svg: string, documentTitle: string) {
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow?.document;
  if (!doc) {
    iframe.remove();
    return;
  }

  // Landscape + scale-to-fit, since a prerequisite graph is almost always wider
  // than it is tall once a few levels build up.
  doc.open();
  doc.write(`<!doctype html><html><head><title>${escapeXml(documentTitle)}</title>
<style>
  @page { size: A4 landscape; margin: 10mm; }
  html, body { margin: 0; padding: 0; }
  svg { width: 100%; height: auto; }
</style>
</head><body>${svg}</body></html>`);
  doc.close();

  const run = () => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    // Removing the iframe immediately can cancel the print job in some browsers,
    // so give the dialog time to take ownership of the document first.
    setTimeout(() => iframe.remove(), 60000);
  };

  if (doc.readyState === 'complete') run();
  else iframe.onload = run;
}

/** Concept list as CSV - the "soft form" that's actually editable/reviewable in
 *  Excel or Word, alongside the visual formats above. */
export function downloadConceptCsv(
  nodes: ExportNode[],
  edges: ExportEdge[],
  descriptions: Record<string, string>,
  filename: string,
) {
  const nameById = new Map(nodes.map(n => [n.id, n.name]));
  const prereqsById = new Map<string, string[]>();
  edges.forEach(e => {
    const list = prereqsById.get(e.target) ?? [];
    list.push(nameById.get(e.source) ?? e.source);
    prereqsById.set(e.target, list);
  });

  const cell = (value: string) => `"${(value ?? '').replace(/"/g, '""')}"`;
  const rows = [
    ['Concept', 'Difficulty', 'Description', 'Prerequisites'].map(cell).join(','),
    ...nodes.map(n =>
      [
        n.name,
        n.difficulty,
        descriptions[n.id] ?? '',
        (prereqsById.get(n.id) ?? []).join('; '),
      ]
        .map(cell)
        .join(','),
    ),
  ];

  // BOM so Excel opens the file as UTF-8 instead of mangling any accented characters.
  triggerDownload(new Blob(['﻿' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' }), filename);
}

export const slugify = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'course';
