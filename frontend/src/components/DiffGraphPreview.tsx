import React, { useMemo, useRef, useState, useEffect } from 'react';
import { Maximize2, Minimize2, ZoomIn, ZoomOut } from 'lucide-react';
import type { ConceptDiffItem } from '../services/api';

// Read-only node/edge picture of a proposed graph diff - shown to the teacher
// reviewing their draft and to the coordinator deciding on final approval, so a
// diff reads as the prerequisite tree it's about to become instead of a flat list.
//
// Deliberately a plain SVG rather than the React Flow canvas used by the live
// graph page: React Flow derives every edge's endpoints from node measurements it
// takes itself, and that measurement pass doesn't run for a container mounted
// inside a modal - nodes appear but no connections ever draw. Laying the tree out
// directly has no such dependency.

const NODE_R = 34;
const EXISTING_R = 26;
const H_SPACING = 190;
const V_SPACING = 165;
const PADDING = 48;

const difficultyColors = (difficulty: string) => {
  switch ((difficulty || '').toLowerCase()) {
    case 'easy': return { fill: '#6ee7b7', stroke: '#10b981', text: '#022c22' };
    case 'hard': return { fill: '#fda4af', stroke: '#f43f5e', text: '#4c0519' };
    default: return { fill: '#fcd34d', stroke: '#f59e0b', text: '#451a03' };
  }
};

interface PositionedNode {
  id: string;
  label: string;
  x: number;
  y: number;
  r: number;
  isExisting: boolean;
  difficulty: string;
}

interface DiffGraphPreviewProps {
  concepts: ConceptDiffItem[];
  className?: string;
}

export const DiffGraphPreview: React.FC<DiffGraphPreviewProps> = ({ concepts, className }) => {
  // Fullscreen review. Both people who ever look at this - the teacher checking
  // their own draft and the coordinator deciding whether to merge it - were doing
  // so through a ~270px window with the diff scrolled inside it, which is not
  // enough to judge a prerequisite tree you're about to commit to a shared
  // curriculum. Living on the component (not the call sites) means the teacher
  // draft panel, the submission log and the coordinator's approval modal all get
  // it without each having to wire it up.
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Zoom, held as a multiplier ON TOP of the base scale (1:1 inline, scaled-to-fit
  // in fullscreen) rather than as an absolute scale, so the reset button can mean
  // "back to how this mode started" without needing to know the container size.
  // The label still reports the true scale. Scaling to fit alone isn't enough on
  // a large proposal - fitting 60 concepts on screen makes every label too small
  // to read, which is no use to someone deciding whether to merge it.
  const [zoomFactor, setZoomFactor] = useState(1);
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    // Read from the browser rather than assuming, so Esc (which bypasses the
    // button entirely) still leaves the icon and layout in the right state.
    // Every mounted preview hears this event, so the zoom reset is guarded on
    // THIS instance actually changing mode - otherwise expanding one diff
    // fullscreen would reset the zoom on every other one on the page.
    const wasFullscreen = { current: false };
    const sync = () => {
      const nowFullscreen = document.fullscreenElement === wrapRef.current;
      if (wasFullscreen.current !== nowFullscreen) {
        wasFullscreen.current = nowFullscreen;
        setZoomFactor(1);   // entering/leaving changes the base scale under it
      }
      setIsFullscreen(nowFullscreen);
    };
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  // The fit scale depends on the container's actual size, which changes when
  // entering fullscreen and when the window resizes.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(entries => {
      const rect = entries[0].contentRect;
      setCanvasSize({ w: rect.width, h: rect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await wrapRef.current?.requestFullscreen();
    } catch {
      /* blocked by the browser - stay inline, nothing else changes */
    }
  };

  const { positioned, links, width, height } = useMemo(() => {
    const defined = new Map(concepts.map(c => [c.name, c]));
    // Prerequisite names this diff references but doesn't define - they already
    // live in the shared catalog graph. Drawn as smaller dashed nodes so every
    // connection still starts somewhere visible.
    const existing = new Set<string>();
    concepts.forEach(c => c.prerequisites.forEach(p => {
      if (!defined.has(p)) existing.add(p);
    }));

    const allIds = [...concepts.map(c => c.name), ...existing];
    const edgeList = concepts.flatMap(c =>
      c.prerequisites.map(p => ({ source: p, target: c.name }))
    ).filter(e => defined.has(e.source) || existing.has(e.source));

    // Longest-path levelling: a concept always sits below every prerequisite it
    // depends on. Cycle-safe via a visit cap, since AI-proposed prerequisites are
    // not guaranteed to be acyclic.
    const adj: Record<string, string[]> = {};
    const inDegree: Record<string, number> = {};
    allIds.forEach(id => { adj[id] = []; inDegree[id] = 0; });
    edgeList.forEach(e => {
      adj[e.source].push(e.target);
      inDegree[e.target] += 1;
    });

    const levels: Record<string, number> = {};
    const queue: string[] = [];
    allIds.forEach(id => { if (inDegree[id] === 0) { levels[id] = 0; queue.push(id); } });
    let guard = allIds.length * 20;
    while (queue.length && guard-- > 0) {
      const u = queue.shift()!;
      adj[u].forEach(v => {
        const next = (levels[u] || 0) + 1;
        if (next > (levels[v] ?? -1)) { levels[v] = next; queue.push(v); }
      });
    }
    allIds.forEach(id => { if (levels[id] === undefined) levels[id] = 0; });

    const groups: Record<number, string[]> = {};
    allIds.forEach(id => {
      const lvl = levels[id];
      (groups[lvl] ||= []).push(id);
    });

    // Crossing reduction (barycenter heuristic, the ordering step of a layered
    // graph layout). Levelling alone leaves each row in arbitrary order, so edges
    // criss-cross the whole canvas and the tree is unreadable at this size. Here
    // each node is repeatedly pulled toward the average slot of its neighbours in
    // the adjacent row, sweeping down then up, which pulls related concepts into
    // vertical alignment and removes most crossings.
    const parents: Record<string, string[]> = {};
    allIds.forEach(id => { parents[id] = []; });
    edgeList.forEach(e => { parents[e.target].push(e.source); });

    const levelKeys = Object.keys(groups).map(Number).sort((a, b) => a - b);
    const indexIn = (lvl: number, id: string) => groups[lvl].indexOf(id);

    const sortByBarycenter = (lvl: number, neighbourLvl: number, neighboursOf: Record<string, string[]>) => {
      const scores = new Map<string, number>();
      groups[lvl].forEach((id, fallback) => {
        const ns = (neighboursOf[id] || []).filter(n => levels[n] === neighbourLvl);
        if (ns.length === 0) { scores.set(id, fallback); return; }
        const avg = ns.reduce((sum, n) => sum + indexIn(neighbourLvl, n), 0) / ns.length;
        scores.set(id, avg);
      });
      groups[lvl] = [...groups[lvl]].sort((a, b) => scores.get(a)! - scores.get(b)!);
    };

    for (let pass = 0; pass < 4; pass++) {
      // Downward sweep: order each row by where its prerequisites sit above it.
      for (let i = 1; i < levelKeys.length; i++) {
        sortByBarycenter(levelKeys[i], levelKeys[i - 1], parents);
      }
      // Upward sweep: order each row by where its dependents sit below it.
      for (let i = levelKeys.length - 2; i >= 0; i--) {
        sortByBarycenter(levelKeys[i], levelKeys[i + 1], adj);
      }
    }

    const widestRow = Math.max(...Object.values(groups).map(g => g.length));
    const contentW = Math.max(widestRow - 1, 0) * H_SPACING;
    const maxLevel = Math.max(...Object.values(levels));

    const nodes: PositionedNode[] = allIds.map(id => {
      const lvl = levels[id];
      const group = groups[lvl];
      const idx = group.indexOf(id);
      const rowW = (group.length - 1) * H_SPACING;
      const concept = defined.get(id);
      return {
        id,
        label: id,
        x: PADDING + contentW / 2 + (idx * H_SPACING - rowW / 2),
        y: PADDING + lvl * V_SPACING,
        r: concept ? NODE_R : EXISTING_R,
        isExisting: !concept,
        difficulty: concept?.difficulty || '',
      };
    });

    const byId = new Map(nodes.map(n => [n.id, n]));
    const drawnLinks = edgeList
      .map(e => ({ from: byId.get(e.source)!, to: byId.get(e.target)! }))
      .filter(l => l.from && l.to);

    return {
      positioned: nodes,
      links: drawnLinks,
      width: contentW + PADDING * 2,
      height: maxLevel * V_SPACING + PADDING * 2,
    };
  }, [concepts]);

  if (concepts.length === 0) return null;

  // Inline the diff renders at natural size and scrolls (a small diff shouldn't
  // be shrunk to fit a 288px box); fullscreen it starts scaled to fit. The -4px
  // stops a rounding remainder from producing a permanent 1px scrollbar.
  //
  // Capped at 1: "fit" means shrink-to-fit, never blow up. Without the cap a
  // two-concept diff fullscreened on a 1080p monitor started at 315%, rendering
  // as a couple of absurd dinner-plate circles. Zooming past natural size is
  // still available, it just isn't the default.
  const baseScale = isFullscreen && canvasSize.w > 0 && canvasSize.h > 0
    ? Math.min(1, (canvasSize.w - 4) / width, (canvasSize.h - 4) / height)
    : 1;
  const scale = Math.max(0.1, Math.min(4, baseScale * zoomFactor));
  const stepZoom = (direction: 1 | -1) =>
    setZoomFactor(z => Math.max(0.25, Math.min(6, z * (direction === 1 ? 1.25 : 1 / 1.25))));

  return (
    <div
      ref={wrapRef}
      className={isFullscreen ? 'bg-surface p-6 h-screen w-screen flex flex-col gap-3' : 'space-y-2'}
    >
      <div className="flex items-center gap-4 flex-wrap text-[12px] text-text-secondary">
        {[
          { label: 'Easy', d: 'easy' },
          { label: 'Medium', d: 'medium' },
          { label: 'Hard', d: 'hard' },
        ].map(({ label, d }) => {
          const c = difficultyColors(d);
          return (
            <span key={d} className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full border-2 inline-block" style={{ background: c.fill, borderColor: c.stroke }} />
              {label}
            </span>
          );
        })}
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full border border-dashed border-slate-400 inline-block" />
          Already in the graph
        </span>
        <span className="text-text-muted">Arrows point up at each prerequisite.</span>

        <div className="ml-auto flex items-center gap-2">
          {/* Zoom. Fullscreen alone only guarantees the whole diff FITS - on a
              large proposal that means unreadably small labels, which is no use
              to someone deciding whether to merge it. */}
          <div className="flex items-center rounded-lg border border-border overflow-hidden">
            <button
              type="button"
              onClick={() => stepZoom(-1)}
              className="px-2 py-1 text-text-secondary hover:text-primary hover:bg-primary-muted transition-all"
              title="Zoom out"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setZoomFactor(1)}
              className="px-2 py-1 text-[12px] font-semibold text-text-secondary hover:text-primary hover:bg-primary-muted border-x border-border transition-all tabular-nums min-w-[3rem]"
              title={isFullscreen ? 'Reset to fit on screen' : 'Reset to actual size'}
            >
              {Math.round(scale * 100)}%
            </button>
            <button
              type="button"
              onClick={() => stepZoom(1)}
              className="px-2 py-1 text-text-secondary hover:text-primary hover:bg-primary-muted transition-all"
              title="Zoom in"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>

          <button
            type="button"
            onClick={toggleFullscreen}
            className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border border-border text-text-secondary hover:text-primary hover:bg-primary-muted transition-all font-semibold"
            title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Review this diff fullscreen'}
          >
            {isFullscreen
              ? <><Minimize2 className="w-3.5 h-3.5" /> Exit fullscreen</>
              : <><Maximize2 className="w-3.5 h-3.5" /> Fullscreen</>}
          </button>
        </div>
      </div>
      {/* One scaling model for both modes: the viewBox fixes the coordinate
          space and width/height carry the zoom, so the container just scrolls
          whenever the scaled drawing is bigger than it. Fullscreen differs only
          in that it fills the remaining height and starts at the fit scale. */}
      <div
        ref={canvasRef}
        className={
          isFullscreen
            ? 'flex-1 min-h-0 rounded-xl border border-border bg-background overflow-auto'
            : `rounded-xl border border-border bg-background overflow-auto ${className || 'h-72'}`
        }
      >
        <svg
          width={Math.round(width * scale)}
          height={Math.round(height * scale)}
          viewBox={`0 0 ${width} ${height}`}
          // mx-auto centres a drawing narrower than the pane (common once the
          // fit scale is capped) without clipping a wider one - an auto inline
          // margin resolves to 0 when the element overflows, unlike flex/grid
          // centring, which would cut off the left edge when zoomed in.
          className="block mx-auto"
        >
        <defs>
          <marker id="diff-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8" />
          </marker>
        </defs>

        {/* Arrowhead sits at the prerequisite end, matching the live graph canvas:
            the arrow points at what you need first, not at what it unlocks.
            Drawn as vertical-tangent beziers rather than straight lines so links
            that span distant rows curve around intervening nodes instead of
            cutting straight through them. */}
        {links.map((l, i) => {
          const x1 = l.from.x;
          const y1 = l.from.y + l.from.r;
          const x2 = l.to.x;
          const y2 = l.to.y - l.to.r;
          const dy = Math.max((y2 - y1) * 0.45, 22);
          return (
            <path
              key={i}
              d={`M ${x1} ${y1} C ${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2}`}
              fill="none"
              stroke="#94a3b8"
              strokeWidth={1.25}
              strokeOpacity={0.75}
              markerStart="url(#diff-arrow)"
            />
          );
        })}

        {positioned.map(n => {
          const colors = difficultyColors(n.difficulty);
          const words = n.label.split(' ');
          // Wrap the label into at most three short lines so long concept names
          // stay legible inside the circle instead of overflowing it.
          const lines: string[] = [];
          let current = '';
          words.forEach(w => {
            if ((current + ' ' + w).trim().length <= 12) current = (current + ' ' + w).trim();
            else { if (current) lines.push(current); current = w; }
          });
          if (current) lines.push(current);
          const shown = lines.slice(0, 3);
          if (lines.length > 3) shown[2] = shown[2].slice(0, 9) + '...';

          return (
            <g key={n.id}>
              <title>{n.label}{n.isExisting ? ' (already in the graph)' : ` - ${n.difficulty}`}</title>
              <circle
                cx={n.x}
                cy={n.y}
                r={n.r}
                fill={n.isExisting ? 'transparent' : colors.fill}
                stroke={n.isExisting ? '#94a3b8' : colors.stroke}
                strokeWidth={n.isExisting ? 1.5 : 3}
                strokeDasharray={n.isExisting ? '4 3' : undefined}
              />
              {shown.map((line, li) => (
                <text
                  key={li}
                  x={n.x}
                  y={n.y + (li - (shown.length - 1) / 2) * 10 + 3}
                  textAnchor="middle"
                  fontSize={9}
                  fontWeight={600}
                  fill={n.isExisting ? '#64748b' : colors.text}
                >
                  {line}
                </text>
              ))}
            </g>
          );
        })}
        </svg>
      </div>
    </div>
  );
};

export default DiffGraphPreview;
