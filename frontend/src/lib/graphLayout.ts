// Layered layout for the concept prerequisite graph.
//
// Extracted from KnowledgeGraph.tsx so the algorithm can be exercised on its own
// (see the layout check in scripts) rather than only through a logged-in browser
// session, and so the export in graphExport.ts always draws the same arrangement
// the canvas shows.
//
// Two stages, in order:
//   1. Longest-path levelling - a concept sits one row below its deepest
//      prerequisite, so "what do I need first" always reads upward.
//   2. Barycenter ordering - repeatedly pull each node toward the average slot of
//      its neighbours in the adjacent row, sweeping down then up. Levelling alone
//      leaves each row in arbitrary insertion order, which is what produced the
//      fan of long edges crossing the whole canvas from a single hub concept.

// Minimal node/edge shapes the layout needs.
export interface LayoutNode { id: string }
export interface LayoutEdge { source: string; target: string }

// Nodes render as 112px circles. The old 160px spacing left only 48px of gap,
// which is why a busy row read as a solid band.
export const H_SPACING = 210;
export const V_SPACING = 220;

// Number of down+up ordering sweeps; a few is enough to settle.
const BARYCENTER_PASSES = 4;

// Output: x/y per node id, the level (row) per node id, and the ordered rows.
export interface LayoutResult {
  positions: Record<string, { x: number; y: number }>;
  levels: Record<string, number>;
  /** Rows, top to bottom, each already in its final left-to-right order. */
  rows: string[][];
}

/** Computes node positions: assigns rows by longest prerequisite path, orders each row
 *  to reduce edge crossings, then centres rows on a shared axis. */
export function layoutPrerequisiteGraph(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
): LayoutResult {
  // Build adjacency (children), parents and in-degree lookups.
  const ids = nodes.map(n => n.id);

  const adj: Record<string, string[]> = {};
  const parents: Record<string, string[]> = {};
  const inDegree: Record<string, number> = {};
  ids.forEach(id => { adj[id] = []; parents[id] = []; inDegree[id] = 0; });
  edges.forEach(e => {
    // Ignore edges pointing at concepts that aren't in this graph - the API can
    // return a relationship whose other end was filtered out.
    if (adj[e.source] && adj[e.target]) {
      adj[e.source].push(e.target);
      parents[e.target].push(e.source);
      inDegree[e.target] += 1;
    }
  });

  // Cycle-safe via a visit cap: AI-proposed prerequisites are not guaranteed
  // acyclic, and an unbounded loop here would hang the page on a cycle.
  const levels: Record<string, number> = {};
  const queue: string[] = [];
  ids.forEach(id => { if (inDegree[id] === 0) { levels[id] = 0; queue.push(id); } });
  let guard = ids.length * 20;
  while (queue.length > 0 && guard-- > 0) {
    const u = queue.shift()!;
    adj[u].forEach(v => {
      const next = (levels[u] || 0) + 1;
      if (next > (levels[v] ?? -1)) { levels[v] = next; queue.push(v); }
    });
  }
  // Anything unreached (only possible inside a cycle) is pinned to the top row.
  ids.forEach(id => { if (levels[id] === undefined) levels[id] = 0; });

  // Group node ids by level (row).
  const groups: Record<number, string[]> = {};
  ids.forEach(id => { (groups[levels[id]] ||= []).push(id); });

  const levelKeys = Object.keys(groups).map(Number).sort((a, b) => a - b);
  const indexIn = (lvl: number, id: string) => groups[lvl].indexOf(id);

  // Reorders one row by the average position of each node's neighbours in the adjacent row.
  const sortByBarycenter = (
    lvl: number,
    neighbourLvl: number,
    neighboursOf: Record<string, string[]>,
  ) => {
    const scores = new Map<string, number>();
    groups[lvl].forEach((id, fallback) => {
      const ns = (neighboursOf[id] || []).filter(n => levels[n] === neighbourLvl);
      // A node with no neighbour in that row keeps its current slot, so isolated
      // concepts don't all pile up at one end.
      scores.set(id, ns.length === 0
        ? fallback
        : ns.reduce((sum, n) => sum + indexIn(neighbourLvl, n), 0) / ns.length);
    });
    groups[lvl] = [...groups[lvl]].sort((a, b) => scores.get(a)! - scores.get(b)!);
  };

  // Stage 2: alternate top-down (using parents) and bottom-up (using children) sweeps.
  for (let pass = 0; pass < BARYCENTER_PASSES; pass++) {
    for (let i = 1; i < levelKeys.length; i++) {
      sortByBarycenter(levelKeys[i], levelKeys[i - 1], parents);
    }
    for (let i = levelKeys.length - 2; i >= 0; i--) {
      sortByBarycenter(levelKeys[i], levelKeys[i + 1], adj);
    }
  }

  // Every row centred on one shared axis, so the pyramid is symmetrical rather
  // than each row being centred on a different point.
  const widestRow = Math.max(...levelKeys.map(k => groups[k].length));
  const canvasCentre = ((widestRow - 1) * H_SPACING) / 2 + 120;

  // Convert level/slot into pixel coordinates.
  const positions: Record<string, { x: number; y: number }> = {};
  ids.forEach(id => {
    const lvl = levels[id];
    const row = groups[lvl];
    const idx = row.indexOf(id);
    const rowW = (row.length - 1) * H_SPACING;
    positions[id] = {
      x: canvasCentre + (idx * H_SPACING - rowW / 2),
      y: lvl * V_SPACING + 60,
    };
  });

  return { positions, levels, rows: levelKeys.map(k => groups[k]) };
}
