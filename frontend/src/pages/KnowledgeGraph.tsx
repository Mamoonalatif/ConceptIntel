// Interactive concept (knowledge) graph page, built on React Flow. Teachers can explore the
// prerequisite graph, click concepts for details, propose edits (every edit goes through
// coordinator approval), generate study material, tag concepts with CLOs, switch to the
// CLO/PLO/GA outcomes view and export the graph. Students are redirected away and only
// reach a search-only version of this screen.
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Edge,
  type Node,
  MarkerType,
  Position,
  useReactFlow,
  useViewport,
  ReactFlowProvider,
} from 'reactflow';
// CSS is imported once in main.tsx (before index.css, so Tailwind wins the cascade) -
// not here, to avoid a second copy racing the import order that fix depends on.

import { useAuth } from '../context/AuthContext';
import { graphService, courseService, contentGenerationService, outcomesService, clearApiCache } from '../services/api';
import { FoxSpinner } from '../components/FoxSpinner';
import type { CLO, PLO } from '../services/api';
import { apiErrorMessage } from '../lib/apiError';
import { layoutPrerequisiteGraph } from '../lib/graphLayout';
import {
  ArrowLeft, RefreshCw, Plus, Link as LinkIcon, Save, Info,
  Trash2, AlertCircle, CheckCircle2, Search, BarChart3,
  X, BookOpen, Zap, Maximize2, Minimize2, Download,
  FileImage, FileCode, FileText, Table2, ZoomIn, ZoomOut, Sparkles
} from 'lucide-react';
import {
  buildGraphSvg, downloadSvg, downloadPng, printGraphAsPdf,
  downloadConceptCsv, slugify, type ExportNode, type ExportEdge
} from '../lib/graphExport';

// A concept node as returned by the graph API.
interface Concept {
  id: string;
  name: string;
  description: string;
  difficulty: string;
  course_id: number;
  material?: string;
}

// ── Node Difficulty → Light Theme Badge Classes ──
// Maps a difficulty label to the Tailwind classes used for node fill, border and badges.
const getDifficultyStyles = (difficulty: string) => {
  switch (difficulty.toLowerCase()) {
    case 'easy':   return { border: 'border-emerald-400', badge: 'badge-easy',   glow: 'shadow-emerald-100', fill: 'bg-emerald-300 border-emerald-500 text-emerald-950' };
    case 'hard':   return { border: 'border-rose-400',    badge: 'badge-hard',    glow: 'shadow-rose-100',   fill: 'bg-rose-300 border-rose-500 text-rose-950' };
    default:       return { border: 'border-amber-400',   badge: 'badge-medium',  glow: 'shadow-amber-100',  fill: 'bg-amber-300 border-amber-500 text-amber-950' };
  }
};

// ── Zoom controls ──
// React Flow's own <Controls/> sit in the bottom-left corner of the canvas and
// are easy to miss; in fullscreen there is also no browser zoom UI to fall back
// on (and Ctrl +/- there would scale the entire page, toolbar included, rather
// than the graph). These live in the toolbar so they're in the same place either
// way.
//
// Deliberately its own component: useViewport() re-renders its caller on every
// frame of a pan or zoom, and hoisting that into the page component would re-run
// the whole 100-node tree continuously while dragging. Isolated here, only the
// percentage label repaints.
// Toolbar zoom buttons and live zoom percentage (kept as its own component for performance,
// see the note above).
const ZoomControls: React.FC = () => {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const { zoom } = useViewport();

  return (
    <div className="flex items-center rounded-lg border border-border overflow-hidden">
      <button
        id="zoom-out-btn"
        onClick={() => zoomOut({ duration: 200 })}
        className="px-2 py-1.5 text-text-secondary hover:text-primary hover:bg-primary-muted transition-all"
        title="Zoom out (−)"
      >
        <ZoomOut className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={() => fitView({ padding: 0.18, duration: 300 })}
        className="px-2 py-1.5 text-[12px] font-semibold text-text-secondary hover:text-primary hover:bg-primary-muted border-x border-border transition-all tabular-nums min-w-[3.25rem]"
        title="Fit the whole graph on screen (0)"
      >
        {Math.round(zoom * 100)}%
      </button>
      <button
        id="zoom-in-btn"
        onClick={() => zoomIn({ duration: 200 })}
        className="px-2 py-1.5 text-text-secondary hover:text-primary hover:bg-primary-muted transition-all"
        title="Zoom in (+)"
      >
        <ZoomIn className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};

// ── Inner component that uses useReactFlow ──
// The page itself. Must be rendered inside ReactFlowProvider because it calls useReactFlow().
const KnowledgeGraphInner: React.FC = () => {
  const { courseId } = useParams<{ courseId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { setCenter, zoomIn, zoomOut, fitView } = useReactFlow();

  const idNum = parseInt(courseId || '0');
  const isTeacher = user?.role === 'teacher';

  const [courseName, setCourseName] = useState('');
  // CLO outcomes layer: which CLOs exist for this course's catalog subject, and
  // which ones each concept currently addresses (see app/outcomes/* on the
  // backend). Loaded once the catalog id is known.
  const [catalogId, setCatalogId] = useState<number | null>(null);
  const [clos, setClos] = useState<CLO[]>([]);
  // Every PLO, to resolve a CLO's plo_ids into codes wherever CLOs are shown -
  // the Concept -> CLO -> PLO chain's next link (see app/outcomes/* backend).
  const [plos, setPlos] = useState<PLO[]>([]);
  const [conceptCloMap, setConceptCloMap] = useState<Record<string, number[]>>({});
  const [savingConceptClos, setSavingConceptClos] = useState(false);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  // Outcomes view: swaps the canvas from the plain Concept/PREREQUISITE graph to
  // the Concept -> CLO -> PLO -> GA chain (app/outcomes/services.py
  // get_catalog_outcomes_graph). Concepts are collapsed into a count per CLO here
  // rather than drawn individually - the point of this view is the CLO/PLO/GA
  // structure, not re-showing concepts already visible in the default view.
  const [graphView, setGraphView] = useState<'concepts' | 'outcomes'>('concepts');
  const [outcomeNodes, setOutcomeNodes] = useState<Node[]>([]);
  const [outcomeEdges, setOutcomeEdges] = useState<Edge[]>([]);
  const [loadingOutcomes, setLoadingOutcomes] = useState(false);
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Search
  const [searchQuery, setSearchQuery] = useState('');
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  // Analytics panel
  const [showAnalytics, setShowAnalytics] = useState(false);

  // Fullscreen + export. Large graphs (a full semester's course can run to 100+
  // concepts) are unreadable in the ~60% of the window left over after the app
  // chrome, so the whole page can go true-fullscreen; and the export menu hands
  // the same graph over in soft form for reports/printouts.
  const pageRef = useRef<HTMLDivElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [exporting, setExporting] = useState('');

  // Selected Node Side Panel (opened from the popup's "Edit" button, teacher only)
  const [selectedNode, setSelectedNode] = useState<Concept | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editDiff, setEditDiff] = useState('Medium');
  const [updatingNode, setUpdatingNode] = useState(false);
  // Per-action in-flight flags. Every mutating button reflects its own state
  // immediately (spinner + disabled) rather than looking idle while a request is
  // running, which is what made double submits possible.
  const [deletingNode, setDeletingNode] = useState(false);
  const [creatingNode, setCreatingNode] = useState(false);
  const [creatingEdge, setCreatingEdge] = useState(false);
  const [removingLinkId, setRemovingLinkId] = useState('');

  // Click popup: a lightweight floating card showing name/difficulty/description
  // right where the node was clicked, rather than jumping straight to a persistent
  // sidebar. Position is clamped to the viewport so it never renders off-screen.
  const [popupNode, setPopupNode] = useState<{ concept: Concept; x: number; y: number } | null>(null);

  // Inline "generate study material" composer inside the node popup.
  const [genOpen, setGenOpen] = useState(false);
  const [genType, setGenType] = useState('flashcard');
  const [genDiff, setGenDiff] = useState<'Easy' | 'Medium' | 'Hard'>('Medium');
  const [genTarget, setGenTarget] = useState<'concept' | 'parent' | 'combined'>('concept');
  const [genBusy, setGenBusy] = useState(false);
  const [genMsg, setGenMsg] = useState('');

  // Detailed "material" field on the selected node - AI-generate/refine, teacher
  // only. Both actions submit a GraphEditProposal awaiting coordinator approval,
  // same as every other node edit, so success just confirms submission.
  const [materialBusy, setMaterialBusy] = useState(false);
  const [materialRefineOpen, setMaterialRefineOpen] = useState(false);
  const [materialInstruction, setMaterialInstruction] = useState('');

  // Auto-extract CLOs from the course outline - teacher only. CLOs have no other
  // creation UI in this app, so this is the first way to get them onto a subject
  // at all without hitting the API directly.
  const [autoExtractingClos, setAutoExtractingClos] = useState(false);
  const [cloExtractMsg, setCloExtractMsg] = useState('');

  // Add Node Modal
  const [showNodeModal, setShowNodeModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newDiff, setNewDiff] = useState('Medium');

  // Add Edge Modal
  const [showEdgeModal, setShowEdgeModal] = useState(false);
  const [sourceName, setSourceName] = useState('');
  const [targetName, setTargetName] = useState('');

  // ── Level-Based Hierarchical Layout ──
  // Top-to-bottom prerequisite pyramid: foundational concepts (no prerequisites
  // of their own) sit at the top row, with edges running down toward whatever
  // depends on them - a concept's prerequisite is always above it, and the
  // arrowhead (markerStart, below) points back up at that prerequisite.
  // Algorithm lives in lib/graphLayout.ts (see the notes there on why plain
  // levelling wasn't enough); this just applies the result to the flow nodes.
  // Computes x/y positions for every node using the layout helper and returns positioned nodes.
  const applyLevelLayout = useCallback((nodesList: any[], edgesList: any[]) => {
    const { positions } = layoutPrerequisiteGraph(nodesList, edgesList);
    return nodesList.map(node => ({ ...node, position: positions[node.id] }));
  }, []);

  // ── Load Graph Data ──
  // `force` bypasses the GET cache in services/api.ts - the Refresh button must
  // always mean "go and ask the server", never "hand me what you already had".
  // Fetches the course, its CLOs and the graph, converts the API nodes/edges into React
  // Flow nodes/edges (styled by difficulty), lays them out and stores them in state.
  const loadGraphData = async (force = false) => {
    try {
      if (force) clearApiCache();
      setLoading(true);
      setError('');
      const courseData = await courseService.getDetails(idNum);
      setCourseName(courseData.name);
      setCatalogId(courseData.catalog_id ?? null);
      if (courseData.catalog_id) {
        outcomesService.listCLOs(courseData.catalog_id).then(setClos).catch(() => setClos([]));
        outcomesService.listConceptCLOMap(courseData.catalog_id)
          .then((rows) => {
            const map: Record<string, number[]> = {};
            rows.forEach((r) => { map[r.concept_node_id] = r.clo_ids; });
            setConceptCloMap(map);
          })
          .catch(() => setConceptCloMap({}));
      }
      const data = await graphService.getGraph(idNum);
      setConcepts(data.nodes);

      const flowNodes: Node[] = data.nodes.map((concept: any) => {
        const styles = getDifficultyStyles(concept.difficulty);
        return {
          id: concept.id,
          data: {
            // Concept name only - difficulty is carried by the circle's own color,
            // everything else (description, difficulty label) lives in the click
            // popup below, not on the node itself.
            label: (
              <span className="text-[12px] font-bold leading-tight line-clamp-2 text-center px-1">
                {concept.name}
              </span>
            ),
            concept,
          },
          type: 'default',
          position: { x: 0, y: 0 },
          // A concept's prerequisite always sits above it in this layout, so its
          // own outgoing connection exits from the bottom (heading down to whatever
          // depends on it) and incoming prerequisite links arrive at the top.
          sourcePosition: Position.Bottom,
          targetPosition: Position.Top,
          className: `flex items-center justify-center w-28 h-28 rounded-full border-4 ${styles.fill} shadow-md ${styles.glow} hover:shadow-lg hover:scale-[1.05] transition-all cursor-pointer`,
        };
      });

      const flowEdges: Edge[] = data.edges.map((edge: any) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        // Bezier, not straight. A hub concept that many others depend on produced
        // a fan of straight lines cutting diagonally across the whole canvas and
        // through unrelated nodes - the main source of the clutter. Curves leave
        // each node vertically and bend toward their target, so links that span
        // distant rows bow around what's between them instead of slicing through.
        type: 'default',
        animated: false,
        // markerStart (not markerEnd): the arrowhead sits at the SOURCE end of the
        // line - the prerequisite concept - pointing back up at it, since that's
        // what "X is a prerequisite of Y" means: the arrow points at the thing you
        // need first, not at the thing it unlocks.
        markerStart: { type: MarkerType.ArrowClosed, color: '#94a3b8', width: 16, height: 16 },
        // Lighter and thinner than the nodes so the concepts stay the foreground
        // and a dense middle row reads as texture rather than a wall of lines.
        style: { strokeWidth: 1.25, stroke: '#94a3b8', strokeOpacity: 0.65 },
      }));

      const structured = applyLevelLayout(flowNodes, flowEdges);
      setNodes(structured);
      setEdges(flowEdges);
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not load the concept graph.'));
    } finally {
      setLoading(false);
    }
  };

  // Students don't view/interact with the raw concept graph directly - they
  // work with it indirectly (generated study materials, mastery tracking, the
  // Adaptive Engine's revision plan). Redirect rather than just hiding the
  // entry point, so a direct URL doesn't bypass this.
  useEffect(() => {
    if (user && user.role === 'student') {
      navigate(`/course/${courseId}`, { replace: true });
    }
  }, [user, courseId]);

  // Load the graph when the course id changes; load the list of PLOs once on mount.
  useEffect(() => { if (idNum) loadGraphData(); }, [courseId]);
  useEffect(() => { outcomesService.listPLOs().then(setPlos).catch(() => setPlos([])); }, []);

  // ── Load the Outcomes view (Concept -> CLO -> PLO -> GA) ──
  // Three ranked columns, left to right: CLO, PLO, GA. A concept edge into a CLO
  // is summarised as a count on the CLO node rather than drawn, since every
  // concept already has its own node in the default view.
  useEffect(() => {
    if (graphView !== 'outcomes' || !catalogId) return;
    let cancelled = false;
    setLoadingOutcomes(true);
    outcomesService.getOutcomesGraph(catalogId).then((data) => {
      if (cancelled) return;
      const conceptCounts: Record<string, number> = {};
      data.concept_clo_edges.forEach((e) => {
        conceptCounts[e.clo_id] = (conceptCounts[e.clo_id] || 0) + 1;
      });
      const COL_GAP = 260, ROW_GAP = 130;
      const colX = { clo: 0, plo: COL_GAP, ga: COL_GAP * 2 };
      const mkNode = (id: string, idx: number, col: 'clo' | 'plo' | 'ga', label: string, sub?: string): Node => ({
        id, position: { x: colX[col], y: idx * ROW_GAP },
        sourcePosition: Position.Right, targetPosition: Position.Left,
        data: {
          label: (
            <span className="text-[11px] font-bold leading-tight text-center px-1">
              {label}{sub ? <span className="block text-[9px] font-normal opacity-80">{sub}</span> : null}
            </span>
          ),
        },
        className: `flex flex-col items-center justify-center w-40 h-16 rounded-xl border-2 shadow-md ${
          col === 'clo' ? 'bg-primary-muted border-primary/40 text-primary' :
          col === 'plo' ? 'bg-secondary-muted border-secondary/40 text-secondary' :
          'bg-slate-200 border-slate-400 text-slate-800'
        }`,
      });

      const nodesOut: Node[] = [
        ...data.clos.map((c, i) => mkNode(`clo-${c.id}`, i, 'clo', c.code, `${conceptCounts[c.id] || 0} concept(s)`)),
        ...data.plos.map((p, i) => mkNode(`plo-${p.id}`, i, 'plo', p.code, p.title)),
        ...data.gas.map((g, i) => mkNode(`ga-${g.id}`, i, 'ga', g.code, g.title)),
      ];
      const edgeStyle = { strokeWidth: 1.5, stroke: '#94a3b8', strokeOpacity: 0.75 };
      const marker = { type: MarkerType.ArrowClosed, color: '#94a3b8', width: 14, height: 14 };
      const edgesOut: Edge[] = [
        ...data.clo_plo_edges.map((e) => ({
          id: `cp-${e.clo_id}-${e.plo_id}`, source: `clo-${e.clo_id}`, target: `plo-${e.plo_id}`,
          markerEnd: marker, style: edgeStyle,
        })),
        ...data.plo_ga_edges.map((e) => ({
          id: `pg-${e.plo_id}-${e.ga_id}`, source: `plo-${e.plo_id}`, target: `ga-${e.ga_id}`,
          markerEnd: marker, style: edgeStyle,
        })),
      ];
      setOutcomeNodes(nodesOut);
      setOutcomeEdges(edgesOut);
    }).catch(() => {
      if (!cancelled) { setOutcomeNodes([]); setOutcomeEdges([]); }
    }).finally(() => { if (!cancelled) setLoadingOutcomes(false); });
    return () => { cancelled = true; };
  }, [graphView, catalogId]);

  // ── Auto-clear alerts ──
  useEffect(() => {
    if (success) { const t = setTimeout(() => setSuccess(''), 4000); return () => clearTimeout(t); }
  }, [success]);
  useEffect(() => {
    if (error)   { const t = setTimeout(() => setError(''), 6000);   return () => clearTimeout(t); }
  }, [error]);

  // ── Fullscreen ──
  // Driven off the browser's own fullscreenchange event rather than assumed from
  // the click, so pressing Esc (which never goes through our button) still leaves
  // the icon in the right state.
  useEffect(() => {
    const sync = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  // Enter or leave browser fullscreen for the whole page.
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await pageRef.current?.requestFullscreen();
    } catch {
      setError('Fullscreen was blocked by the browser.');
    }
  };

  // Keyboard zoom: +/- to step, 0 to fit. Only bound for teachers (students
  // never get the canvas) and deliberately ignored while typing, so pressing
  // "-" inside the concept-search box or a description field types a character
  // instead of zooming the graph out from under you.
  useEffect(() => {
    if (!isTeacher) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;   // leave browser zoom alone
      const el = document.activeElement;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement)?.isContentEditable) return;

      if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomIn({ duration: 200 }); }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomOut({ duration: 200 }); }
      else if (e.key === '0') { e.preventDefault(); fitView({ padding: 0.18, duration: 300 }); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isTeacher, zoomIn, zoomOut, fitView]);

  // ── Export menu ──
  useEffect(() => {
    if (!showExportMenu) return;
    const onOutsideClick = (e: MouseEvent) => {
      // globalThis.Node, not Node - reactflow's Node type is imported above and
      // would otherwise shadow the DOM one here.
      if (!exportMenuRef.current?.contains(e.target as globalThis.Node)) setShowExportMenu(false);
    };
    document.addEventListener('mousedown', onOutsideClick);
    return () => document.removeEventListener('mousedown', onOutsideClick);
  }, [showExportMenu]);

  // The export redraws the graph from these positions rather than capturing the
  // canvas, so every concept lands in the file - not just the part currently
  // panned into view.
  // Plain-data version of the current nodes/edges (positions, names, difficulty) for export.
  const exportPayload = useMemo(() => {
    const exportNodes: ExportNode[] = nodes.map(n => ({
      id: n.id,
      x: n.position.x,
      y: n.position.y,
      name: (n.data as any)?.concept?.name ?? n.id,
      difficulty: (n.data as any)?.concept?.difficulty ?? 'Medium',
    }));
    const exportEdges: ExportEdge[] = edges.map(e => ({ source: e.source, target: e.target }));
    return { exportNodes, exportEdges };
  }, [nodes, edges]);

  // Exports the graph as PNG, SVG, PDF (via print) or a CSV concept list.
  const handleExport = async (format: 'png' | 'svg' | 'pdf' | 'csv') => {
    setShowExportMenu(false);
    if (concepts.length === 0) { setError('There are no concepts to export yet.'); return; }

    const base = `${slugify(courseName || 'course')}-knowledge-graph`;
    const { exportNodes, exportEdges } = exportPayload;
    setExporting(format);
    try {
      if (format === 'csv') {
        const descriptions = Object.fromEntries(concepts.map(c => [c.id, c.description]));
        downloadConceptCsv(exportNodes, exportEdges, descriptions, `${base}.csv`);
      } else {
        const svg = buildGraphSvg(
          exportNodes, exportEdges,
          courseName || 'Course',
          new Date().toLocaleDateString(),
        );
        if (format === 'svg') downloadSvg(svg, `${base}.svg`);
        else if (format === 'png') await downloadPng(svg, `${base}.png`);
        else printGraphAsPdf(svg, base);
      }
      setSuccess(
        format === 'pdf'
          ? 'Print dialog opened — choose "Save as PDF" as the destination.'
          : `Concept graph downloaded as ${format.toUpperCase()}.`,
      );
    } catch (e: any) {
      setError(e?.message || 'Export failed.');
    } finally {
      setExporting('');
    }
  };

  // ── Node Click: open a popup right at the click point, not the sidebar ──
  // Opens the concept popup at the click position.
  const onNodeClick = (event: React.MouseEvent, node: Node) => {
    const concept = concepts.find(c => c.id === node.id);
    if (!concept) return;

    // Clamp so the ~280px-wide popup never renders partly off-screen.
    const popupWidth = 288;
    const popupHeight = 220;
    const x = Math.min(event.clientX, window.innerWidth - popupWidth - 16);
    const y = Math.min(event.clientY, window.innerHeight - popupHeight - 16);
    setPopupNode({ concept, x, y });
  };

  // Moves from the popup to the side panel edit form for the same concept.
  const openEditFromPopup = () => {
    if (!popupNode) return;
    const concept = popupNode.concept;
    setSelectedNode(concept);
    setEditName(concept.name);
    setEditDesc(concept.description);
    setEditDiff(concept.difficulty);
    setPopupNode(null);
  };

  // ── Search ──
  // Concepts whose name contains the search text.
  const filteredConcepts = useMemo(() => {
    if (!searchQuery.trim()) return [];
    return concepts.filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [searchQuery, concepts]);

  // Picks a search result: highlights it, zooms the canvas to it and opens its side panel.
  const handleSearchSelect = (concept: Concept) => {
    setHighlightedId(concept.id);
    setSearchQuery('');
    // Find node position and zoom to it
    const node = nodes.find(n => n.id === concept.id);
    if (node) {
      setCenter(node.position.x + 100, node.position.y + 60, { zoom: 1.5, duration: 600 });
    }
    setSelectedNode(concept);
    setEditName(concept.name);
    setEditDesc(concept.description);
    setEditDiff(concept.difficulty);
    setTimeout(() => setHighlightedId(null), 2000);
  };

  // ── Update Node ──
  // Submits the edited name/description/difficulty (becomes an edit proposal for approval).
  const handleUpdateNode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedNode) return;
    setUpdatingNode(true);
    try {
      await graphService.updateNode(idNum, selectedNode.id, { name: editName, description: editDesc, difficulty: editDiff });
      setSuccess(`Update to "${editName}" submitted for course coordinator approval.`);
      setSelectedNode(null);
      loadGraphData();
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not save your changes to this concept.'));
    } finally {
      setUpdatingNode(false);
    }
  };

  // ── Delete Node ──
  // Proposes deletion of the selected concept after confirmation.
  const handleDeleteNode = async () => {
    if (!selectedNode) return;
    if (!window.confirm(`Delete concept "${selectedNode.name}"? All prerequisite links will also be removed.`)) return;
    setDeletingNode(true);
    try {
      await graphService.deleteNode(idNum, selectedNode.id);
      setSuccess(`Deletion of "${selectedNode.name}" submitted for course coordinator approval.`);
      setSelectedNode(null);
      loadGraphData();
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not delete this concept.'));
    } finally {
      setDeletingNode(false);
    }
  };

  // ── Generate/Refine Material (AI) ──
  // Asks the AI to generate the node's detailed material (submitted for approval).
  const handleGenerateMaterial = async () => {
    if (!selectedNode || materialBusy) return;
    setMaterialBusy(true);
    try {
      await graphService.generateNodeMaterial(idNum, selectedNode.id);
      setSuccess(`Detailed material for "${selectedNode.name}" generated and submitted for course coordinator approval.`);
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not generate material for this concept.'));
    } finally {
      setMaterialBusy(false);
    }
  };

  // Asks the AI to refine the node's material following the teacher's instruction.
  const handleEditMaterial = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedNode || materialBusy || !materialInstruction.trim()) return;
    setMaterialBusy(true);
    try {
      await graphService.editNodeMaterial(idNum, selectedNode.id, materialInstruction.trim());
      setSuccess(`Refinement to "${selectedNode.name}"'s material submitted for course coordinator approval.`);
      setMaterialInstruction('');
      setMaterialRefineOpen(false);
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not refine material for this concept.'));
    } finally {
      setMaterialBusy(false);
    }
  };

  // ── Auto-extract CLOs from the course outline (AI) ──
  // Extracts CLOs from the course outline with AI, then reloads CLOs and concept tags.
  const handleAutoExtractClos = async () => {
    if (autoExtractingClos) return;
    setAutoExtractingClos(true);
    setCloExtractMsg('');
    try {
      const result = await outcomesService.autoExtractCLOs(idNum);
      if (catalogId) {
        const [freshClos, freshMap] = await Promise.all([
          outcomesService.listCLOs(catalogId),
          outcomesService.listConceptCLOMap(catalogId),
        ]);
        setClos(freshClos);
        const map: Record<string, number[]> = {};
        freshMap.forEach((r) => { map[r.concept_node_id] = r.clo_ids; });
        setConceptCloMap(map);
      }
      setCloExtractMsg(
        `Extracted ${result.created_clos.length} new CLO(s)`
        + (result.plo_links_created > 0 ? `, linked to ${result.plo_links_created} PLO(s)` : '')
        + (result.concepts_tagged > 0 ? `, tagged ${result.concepts_tagged} concept(s)` : '')
        + '.'
      );
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not auto-extract CLOs from the course outline.'));
    } finally {
      setAutoExtractingClos(false);
    }
  };

  // ── Create Node ──
  // Proposes a new concept from the Add Concept form.
  const handleCreateNode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (creatingNode) return;   // guard against a double submit from a fast second click
    setCreatingNode(true);
    try {
      await graphService.createNode(idNum, { name: newName, description: newDesc, difficulty: newDiff });
      setSuccess(`Concept "${newName}" submitted for course coordinator approval.`);
      setNewName(''); setNewDesc(''); setNewDiff('Medium');
      setShowNodeModal(false);
      loadGraphData();
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not create this concept.'));
    } finally {
      setCreatingNode(false);
    }
  };

  // ── Create Edge ──
  // Proposes a prerequisite link between two chosen concepts.
  const handleCreateEdge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (creatingEdge) return;
    if (sourceName === targetName) { setError('A concept cannot be its own prerequisite.'); return; }
    setCreatingEdge(true);
    try {
      await graphService.createPrerequisite(sourceName, targetName, idNum);
      setSuccess(`Link "${sourceName}" → "${targetName}" submitted for course coordinator approval.`);
      setSourceName(''); setTargetName('');
      setShowEdgeModal(false);
      loadGraphData();
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not link these concepts.'));
    } finally {
      setCreatingEdge(false);
    }
  };

  // ── Delete Relationship ──
  // Proposes removing a prerequisite link after confirmation.
  const handleDeleteRelationship = async (sourceId: string, targetId: string) => {
    if (!window.confirm('Remove this prerequisite connection?')) return;
    setRemovingLinkId(`${sourceId}->${targetId}`);
    try {
      await graphService.deleteRelationship(idNum, sourceId, targetId);
      setSuccess('Removal of prerequisite link submitted for course coordinator approval.');
      loadGraphData();
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not remove this prerequisite link.'));
    } finally {
      setRemovingLinkId('');
    }
  };

  // ── Prerequisites of selected node ──
  // Direct prerequisites of the selected node, derived from incoming edges.
  const prerequisites = useMemo(() => {
    if (!selectedNode) return [];
    return edges
      .filter(e => e.target === selectedNode.id)
      .map(e => {
        const src = concepts.find(c => c.id === e.source);
        return { id: e.id, sourceId: e.source, targetId: e.target, name: src?.name ?? 'Unknown' };
      });
  }, [selectedNode, edges, concepts]);

  // ── The popup node's own prerequisite, for "generate for the parent instead" ──
  // Edge direction is prerequisite -> dependent, so a parent is the SOURCE of an
  // edge pointing at this node. Only the first is offered: the backend picks the
  // most foundational one by importance, and one clear choice beats a sub-menu here.
  const parentOfPopupNode = useMemo(() => {
    if (!popupNode) return null;
    const parentEdge = edges.find(e => e.target === popupNode.concept.id);
    if (!parentEdge) return null;
    return concepts.find(c => c.id === parentEdge.source) ?? null;
  }, [popupNode, edges, concepts]);

  // Generates study material (flashcards, MCQs, quiz, study guide) for the popup concept.
  const handleGenerateFromGraph = async () => {
    if (!popupNode) return;
    setGenBusy(true);
    setGenMsg('');
    try {
      const created = await contentGenerationService.generate(idNum, {
        concept_node_id: popupNode.concept.id,
        concept_name: popupNode.concept.name,
        content_type: genType,
        difficulty: genDiff,
        target: genTarget,
      });
      setGenOpen(false);
      setGenTarget('concept');
      setSuccess(`"${created.title}" generated and waiting for your review.`);
    } catch (err) {
      setGenMsg(apiErrorMessage(err, 'Could not generate material for this concept.'));
    } finally {
      setGenBusy(false);
    }
  };

  // ── Focus mode ──
  // On a course-sized graph even a well-ordered layout is busy. Selecting a
  // concept fades everything that isn't it or one hop away, so you can actually
  // trace what a concept depends on and what depends on it. Nothing is hidden -
  // dimmed, not removed - so the overall shape stays readable.
  // Id of the concept currently in focus, used to dim unrelated nodes and edges.
  const focusId = popupNode?.concept.id ?? selectedNode?.id ?? highlightedId ?? null;

  // Set containing the focused node and its direct neighbours (null when nothing is focused).
  const neighbourIds = useMemo(() => {
    if (!focusId) return null;
    const set = new Set<string>([focusId]);
    edges.forEach(e => {
      if (e.source === focusId) set.add(e.target);
      if (e.target === focusId) set.add(e.source);
    });
    return set;
  }, [focusId, edges]);

  // Nodes as actually rendered: adds highlight ring and fades non-neighbours.
  const displayNodes = useMemo(() => nodes.map(n => ({
    ...n,
    className: `${n.className} ${n.id === highlightedId ? 'ring-2 ring-primary ring-offset-2 scale-105' : ''}`,
    style: {
      ...n.style,
      opacity: neighbourIds && !neighbourIds.has(n.id) ? 0.22 : 1,
      transition: 'opacity 180ms ease',
    },
  })), [nodes, highlightedId, neighbourIds]);

  // Edges as actually rendered: emphasises edges touching the focused node, fades the rest.
  const displayEdges = useMemo(() => edges.map(e => {
    const related = !focusId || e.source === focusId || e.target === focusId;
    return {
      ...e,
      style: {
        ...e.style,
        strokeOpacity: related ? (focusId ? 0.95 : 0.65) : 0.08,
        strokeWidth: related && focusId ? 2 : 1.25,
        stroke: related && focusId ? '#6366f1' : '#94a3b8',
      },
    };
  }), [edges, focusId]);

  // ── Graph Analytics ──
  // Counts and percentages of concepts per difficulty, plus link count, for the analytics bar.
  const analytics = useMemo(() => {
    const easy   = concepts.filter(c => c.difficulty.toLowerCase() === 'easy').length;
    const medium = concepts.filter(c => c.difficulty.toLowerCase() === 'medium').length;
    const hard   = concepts.filter(c => c.difficulty.toLowerCase() === 'hard').length;
    const total  = concepts.length || 1;
    return { easy, medium, hard, total: concepts.length, edgeCount: edges.length, easy_pct: Math.round(easy/total*100), med_pct: Math.round(medium/total*100), hard_pct: Math.round(hard/total*100) };
  }, [concepts, edges]);

  return (
    <div ref={pageRef} className="h-screen w-screen bg-background flex flex-col overflow-hidden">

      {/* ── Top Header ── */}
      <header className="glass-panel border-b border-border py-3 px-5 flex items-center justify-between shrink-0 z-20 shadow-soft">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(`/course/${courseId}`)}
            className="p-2 border border-border text-text-secondary hover:text-primary hover:bg-primary-muted rounded-xl transition-all"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h2 className="text-base font-bold text-text-primary flex items-center gap-1.5">
              <span className="gradient-text">Concept Graph</span>
              {courseName && <span className="text-text-muted font-normal">— {courseName}</span>}
            </h2>
            <p className="text-xs text-text-muted">Concept prerequisite map</p>
          </div>
        </div>

        {/* Search Bar */}
        <div className="flex-1 max-w-64 mx-6 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
          <input
            type="text"
            id="concept-search"
            placeholder="Search concepts..."
            className="input-light pl-8 py-1.5 text-xs"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {/* Search Dropdown — teacher only; students see full result cards below instead. */}
          {isTeacher && filteredConcepts.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-surface border border-border rounded-xl shadow-hover z-50 overflow-hidden">
              {filteredConcepts.slice(0, 6).map(c => {
                const styles = getDifficultyStyles(c.difficulty);
                return (
                  <button
                    key={c.id}
                    onClick={() => handleSearchSelect(c)}
                    className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-background text-left transition-colors"
                  >
                    <div className={`w-2 h-2 rounded-full border-2 ${styles.border}`} />
                    <span className="text-xs font-medium text-text-primary truncate">{c.name}</span>
                    <span className="ml-auto text-[11px] text-text-muted">{c.difficulty}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Action Toolbar */}
        <div className="flex items-center gap-2">
          {/* Concepts / Outcomes view toggle - the Concept graph vs the
              Concept -> CLO -> PLO -> GA outcome chain (app/outcomes/*). */}
          {isTeacher && (
            <div className="flex items-center rounded-lg border border-border overflow-hidden text-xs font-semibold">
              <button
                onClick={() => setGraphView('concepts')}
                className={`px-3 py-1.5 transition-all ${graphView === 'concepts' ? 'bg-primary-muted text-primary' : 'text-text-secondary hover:text-primary'}`}
              >
                Concepts
              </button>
              <button
                onClick={() => setGraphView('outcomes')}
                className={`px-3 py-1.5 transition-all border-l border-border ${graphView === 'outcomes' ? 'bg-primary-muted text-primary' : 'text-text-secondary hover:text-primary'}`}
              >
                Outcomes
              </button>
            </div>
          )}
          {/* Analytics Toggle */}
          <button
            id="analytics-toggle"
            onClick={() => setShowAnalytics(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
              showAnalytics ? 'bg-primary-muted border-primary/30 text-primary' : 'border-border text-text-secondary hover:text-primary hover:bg-primary-muted'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            Analytics
          </button>

          {isTeacher && (
            <>
              <button
                id="add-concept-btn"
                onClick={() => setShowNodeModal(true)}
                className="flex items-center gap-1 px-3 py-1.5 border border-primary/30 hover:border-primary text-primary text-xs font-semibold rounded-lg hover:bg-primary-muted transition-all"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Concept
              </button>
              <button
                id="link-prereq-btn"
                onClick={() => setShowEdgeModal(true)}
                className="flex items-center gap-1 px-3 py-1.5 border border-secondary/30 hover:border-secondary text-secondary text-xs font-semibold rounded-lg hover:bg-secondary-muted transition-all"
              >
                <LinkIcon className="w-3.5 h-3.5" />
                Link
              </button>
            </>
          )}

          {isTeacher && (
            <>
              <ZoomControls />

              {/* Export ("soft form" download) */}
              <div className="relative" ref={exportMenuRef}>
                <button
                  id="export-graph-btn"
                  onClick={() => setShowExportMenu(v => !v)}
                  disabled={Boolean(exporting)}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all disabled:opacity-60 ${
                    showExportMenu ? 'bg-primary-muted border-primary/30 text-primary' : 'border-border text-text-secondary hover:text-primary hover:bg-primary-muted'
                  }`}
                  title="Download this graph"
                >
                  <Download className={`w-3.5 h-3.5 ${exporting ? 'animate-pulse' : ''}`} />
                  {exporting ? 'Preparing…' : 'Download'}
                </button>

                {showExportMenu && (
                  <div className="absolute right-0 top-full mt-1 w-60 bg-surface border border-border rounded-xl shadow-hover z-50 overflow-hidden animate-fade-in">
                    {([
                      { key: 'png', icon: FileImage, label: 'PNG image',    hint: 'Full graph, 2x resolution' },
                      { key: 'pdf', icon: FileText,  label: 'PDF document', hint: 'Via print → Save as PDF' },
                      { key: 'svg', icon: FileCode,  label: 'SVG vector',   hint: 'Scales to any size' },
                      { key: 'csv', icon: Table2,    label: 'Concept list (CSV)', hint: 'Names, difficulty, prerequisites' },
                    ] as const).map(({ key, icon: Icon, label, hint }) => (
                      <button
                        key={key}
                        onClick={() => handleExport(key)}
                        className="w-full flex items-start gap-2.5 px-3 py-2.5 hover:bg-background text-left transition-colors"
                      >
                        <Icon className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                        <span className="min-w-0">
                          <span className="block text-xs font-semibold text-text-primary">{label}</span>
                          <span className="block text-[11px] text-text-muted leading-tight">{hint}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Fullscreen - the whole page goes fullscreen (not just the canvas)
                  so this toolbar, and the way back out, stay reachable. */}
              <button
                id="fullscreen-graph-btn"
                onClick={toggleFullscreen}
                className="p-2 border border-border text-text-secondary hover:text-primary hover:bg-primary-muted rounded-lg transition-all"
                title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Open graph in fullscreen'}
              >
                {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
              </button>
            </>
          )}

          <button
            onClick={() => loadGraphData(true)}
            disabled={loading}
            className="p-2 border border-border text-text-secondary hover:text-primary hover:bg-primary-muted rounded-lg transition-all disabled:opacity-60"
            title="Refresh graph"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </header>

      {/* ── Analytics Panel ── */}
      {showAnalytics && (
        <div className="glass-panel border-b border-border px-5 py-3 shrink-0 animate-fade-in">
          <div className="flex items-center gap-8 flex-wrap">
            <div className="flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-primary" />
              <span className="text-xs text-text-muted">Concepts:</span>
              <span className="text-sm font-bold text-text-primary">{analytics.total}</span>
            </div>
            <div className="flex items-center gap-2">
              <LinkIcon className="w-4 h-4 text-secondary" />
              <span className="text-xs text-text-muted">Links:</span>
              <span className="text-sm font-bold text-text-primary">{analytics.edgeCount}</span>
            </div>
            {/* Difficulty distribution bar */}
            <div className="flex items-center gap-3 flex-1 min-w-48">
              <span className="text-xs text-text-muted shrink-0">Difficulty:</span>
              <div className="flex-1 flex h-4 rounded-full overflow-hidden gap-0.5">
                {analytics.easy_pct > 0 && (
                  <div className="bg-emerald-400 flex items-center justify-center text-[9px] text-white font-bold transition-all"
                    style={{ width: `${analytics.easy_pct}%` }}>
                    {analytics.easy > 0 ? analytics.easy : ''}
                  </div>
                )}
                {analytics.med_pct > 0 && (
                  <div className="bg-amber-400 flex items-center justify-center text-[9px] text-white font-bold"
                    style={{ width: `${analytics.med_pct}%` }}>
                    {analytics.medium > 0 ? analytics.medium : ''}
                  </div>
                )}
                {analytics.hard_pct > 0 && (
                  <div className="bg-rose-400 flex items-center justify-center text-[9px] text-white font-bold"
                    style={{ width: `${analytics.hard_pct}%` }}>
                    {analytics.hard > 0 ? analytics.hard : ''}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-3 text-[11px] text-text-muted shrink-0">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />Easy</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />Med</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rose-400 inline-block" />Hard</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Main Canvas Area ── */}
      <div className="flex-1 flex overflow-hidden relative">

        {/* Alert Overlays */}
        <div className="absolute top-4 left-4 z-30 space-y-2 pointer-events-none max-w-sm">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-600 rounded-xl p-3.5 text-xs flex items-center gap-2 pointer-events-auto shadow-card animate-fade-in">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          {success && (
            <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl p-3.5 text-xs flex items-center gap-2 pointer-events-auto shadow-card animate-fade-in">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{success}</span>
            </div>
          )}
        </div>

        {/* Main area: teachers get the full pannable graph explorer; students
            get a search-only concept list instead of free exploration of the
            raw graph (they can only look up concepts by name). */}
        <div className="flex-1 h-full">
          {loading ? (
            <div className="h-full flex flex-col items-center justify-center gap-4">
              <FoxSpinner className="w-14 h-14" label="Loading knowledge structures..." />
            </div>
          ) : isTeacher && graphView === 'outcomes' ? (
            loadingOutcomes ? (
              <div className="h-full flex flex-col items-center justify-center gap-4">
                <FoxSpinner className="w-14 h-14" label="Loading outcomes chain..." />
              </div>
            ) : outcomeNodes.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center gap-2 text-center max-w-sm mx-auto">
                <p className="text-sm font-bold text-text-primary">No outcomes chain yet</p>
                <p className="text-xs text-text-secondary leading-relaxed">
                  Define CLOs for this subject (Concepts view → a concept's sidebar → auto-extract) and link them to PLOs to see this chain.
                </p>
              </div>
            ) : (
              <ReactFlow
                nodes={outcomeNodes}
                edges={outcomeEdges}
                fitView
                fitViewOptions={{ padding: 0.18 }}
                minZoom={0.08}
                maxZoom={2.5}
                nodesDraggable={false}
              >
                <Background color="#dde3f0" gap={20} size={1} />
                <Controls />
              </ReactFlow>
            )
          ) : isTeacher ? (
            <ReactFlow
              nodes={displayNodes}
              edges={displayEdges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeClick={onNodeClick}
              onPaneClick={() => { setPopupNode(null); setSelectedNode(null); }}
              onMove={() => setPopupNode(null)}
              fitView
              // Wider zoom range and a little breathing room around the fitted
              // graph, so a 100+ concept course zooms out far enough to see the
              // whole prerequisite pyramid instead of clipping at the default 0.5.
              fitViewOptions={{ padding: 0.18 }}
              minZoom={0.08}
              maxZoom={2.5}
            >
              <Background color="#dde3f0" gap={20} size={1} />
              <Controls />
              <MiniMap
                nodeStrokeColor="#dde3f0"
                nodeColor="#e8edf8"
                maskColor="rgba(240,244,255,0.5)"
                style={{ background: '#f8faff', border: '1px solid #dde3f0', borderRadius: '12px' }}
              />
            </ReactFlow>
          ) : (
            <div className="h-full overflow-y-auto p-6">
              {!searchQuery.trim() ? (
                <div className="h-full flex flex-col items-center justify-center gap-3 text-center max-w-sm mx-auto">
                  <div className="w-14 h-14 bg-primary-muted rounded-2xl flex items-center justify-center">
                    <Search className="w-6 h-6 text-primary" />
                  </div>
                  <p className="text-sm font-bold text-text-primary">Search for a concept</p>
                  <p className="text-xs text-text-secondary leading-relaxed">
                    Use the search bar above to look up a concept from this course and see its description and prerequisites.
                  </p>
                </div>
              ) : filteredConcepts.length === 0 ? (
                <p className="text-sm text-text-secondary text-center mt-12">No concepts match "{searchQuery}".</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-5xl mx-auto">
                  {filteredConcepts.map(c => {
                    const styles = getDifficultyStyles(c.difficulty);
                    return (
                      <button
                        key={c.id}
                        onClick={() => handleSearchSelect(c)}
                        className={`text-left bg-surface border-2 ${styles.border} rounded-xl p-4 shadow-soft hover:shadow-md transition-all`}
                      >
                        <span className={`inline-block text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full mb-1.5 ${
                          c.difficulty.toLowerCase() === 'easy' ? 'bg-emerald-100 text-emerald-700' :
                          c.difficulty.toLowerCase() === 'hard' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'
                        }`}>{c.difficulty}</span>
                        <h4 className="font-bold text-sm text-text-primary leading-tight">{c.name}</h4>
                        <p className="text-xs text-text-secondary line-clamp-2 mt-1 leading-normal">{c.description}</p>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Click Popup: quick description card at the clicked node's position ── */}
        {popupNode && (
          <div
            className="fixed z-40 w-72 bg-surface border border-border rounded-2xl shadow-hover p-4 animate-fade-in"
            style={{ left: popupNode.x, top: popupNode.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <div>
                <span className={
                  popupNode.concept.difficulty.toLowerCase() === 'easy' ? 'badge-easy' :
                  popupNode.concept.difficulty.toLowerCase() === 'hard' ? 'badge-hard' : 'badge-medium'
                }>{popupNode.concept.difficulty}</span>
                <h4 className="text-sm font-bold text-text-primary mt-1.5">{popupNode.concept.name}</h4>
              </div>
              <button onClick={() => setPopupNode(null)} className="p-1 text-text-muted hover:text-text-primary rounded-lg shrink-0">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <p className="text-xs text-text-secondary leading-relaxed max-h-32 overflow-y-auto">{popupNode.concept.description}</p>

            {/* ── Generate study material straight from the graph ──
                The graph is where a teacher actually notices "students are weak here",
                so generation belongs at that moment rather than behind a trip to
                another page. The parent option resolves the concept's prerequisite
                server-side, so nothing here needs to know the parent's node id. */}
            {isTeacher && (
              <div className="mt-3 border-t border-border pt-3">
                {!genOpen ? (
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setGenOpen(true); setGenMsg(''); }}
                      className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-semibold text-primary bg-primary-muted hover:bg-primary hover:text-white rounded-lg transition-all"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      Generate
                    </button>
                    <button
                      onClick={openEditFromPopup}
                      className="flex-1 py-1.5 text-xs font-semibold text-text-secondary bg-background border border-border hover:border-primary/30 rounded-lg transition-all"
                    >
                      Edit
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <select className="input-light w-full text-xs py-1.5" value={genType} onChange={(e) => setGenType(e.target.value)}>
                      <option value="flashcard">Flashcards</option>
                      <option value="mcq">Practice MCQs</option>
                      <option value="quiz">Quiz</option>
                      <option value="study_guide">Study Guide</option>
                    </select>
                    <div className="flex gap-1.5">
                      {(['Easy', 'Medium', 'Hard'] as const).map((d) => (
                        <button
                          key={d}
                          onClick={() => setGenDiff(d)}
                          className={`flex-1 rounded-lg border py-1 text-[12px] font-bold transition-all ${
                            genDiff === d
                              ? 'border-primary/40 bg-primary-muted text-primary'
                              : 'border-border bg-background text-text-secondary'
                          }`}
                        >
                          {d}
                        </button>
                      ))}
                    </div>
                    {parentOfPopupNode && (
                      <div className="space-y-1">
                        <p className="text-[11px] font-bold uppercase tracking-wide text-text-muted">Cover</p>
                        {([
                          { key: 'concept', label: `Just ${popupNode.concept.name}` },
                          { key: 'combined', label: `${parentOfPopupNode.name} + ${popupNode.concept.name}` },
                          { key: 'parent', label: `Just ${parentOfPopupNode.name}` },
                        ] as const).map(({ key, label }) => (
                          <label key={key} className="flex items-start gap-1.5 text-[12px] text-text-secondary cursor-pointer">
                            <input
                              type="radio"
                              name="kg-gen-target"
                              className="mt-0.5"
                              checked={genTarget === key}
                              onChange={() => setGenTarget(key)}
                            />
                            <span className={genTarget === key ? 'font-semibold text-text-primary' : ''}>{label}</span>
                          </label>
                        ))}
                      </div>
                    )}
                    {genMsg && <p className="text-[12px] text-text-muted">{genMsg}</p>}
                    <div className="flex gap-2">
                      <button
                        onClick={() => { setGenOpen(false); setGenTarget('concept'); }}
                        className="flex-1 py-1.5 text-[12px] font-semibold text-text-secondary bg-background border border-border rounded-lg"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleGenerateFromGraph}
                        disabled={genBusy}
                        className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[12px] font-semibold text-white bg-primary hover:bg-primary-hover rounded-lg transition-all disabled:opacity-50"
                      >
                        {genBusy ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                        {genBusy ? 'Generating' : 'Create'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Sidebar: Concept Detail Panel ── */}
        {selectedNode && (
          <div className="w-80 bg-surface border-l border-border h-full flex flex-col shrink-0 z-10 shadow-card animate-slide-in">
            <div className="px-4 py-3 border-b border-border bg-background flex items-center justify-between">
              <h3 className="text-sm font-bold text-text-primary flex items-center gap-1.5">
                <Info className="w-4 h-4 text-primary" />
                Concept Explorer
              </h3>
              <button onClick={() => setSelectedNode(null)} className="p-1 text-text-muted hover:text-text-primary rounded-lg hover:bg-background transition-all">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-5">
              {isTeacher ? (
                /* Teacher: Edit Form */
                <form onSubmit={handleUpdateNode} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-text-secondary mb-1">Concept Name</label>
                    <input
                      className="input-light text-sm"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-text-secondary mb-1">Difficulty</label>
                    <select
                      className="input-light text-sm"
                      value={editDiff}
                      onChange={(e) => setEditDiff(e.target.value)}
                    >
                      <option>Easy</option>
                      <option>Medium</option>
                      <option>Hard</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-text-secondary mb-1">Description</label>
                    <textarea
                      rows={4}
                      className="input-light text-xs resize-none"
                      value={editDesc}
                      onChange={(e) => setEditDesc(e.target.value)}
                    />
                  </div>
                  <div className="flex gap-2">
                    <button type="submit" disabled={updatingNode || deletingNode}
                      className="flex-1 py-2 btn-primary justify-center text-xs disabled:opacity-60 disabled:cursor-not-allowed">
                      <Save className={`w-3.5 h-3.5 ${updatingNode ? 'animate-pulse' : ''}`} />
                      {updatingNode ? 'Saving…' : 'Save Changes'}
                    </button>
                    <button type="button" onClick={handleDeleteNode} disabled={updatingNode || deletingNode}
                      title="Delete this concept"
                      className="p-2 border border-rose-200 hover:border-rose-400 hover:bg-rose-50 text-rose-400 rounded-lg transition-all disabled:opacity-60 disabled:cursor-not-allowed">
                      {deletingNode
                        ? <RefreshCw className="w-4 h-4 animate-spin" />
                        : <Trash2 className="w-4 h-4" />}
                    </button>
                  </div>
                </form>
              ) : (
                /* Student: Read-Only View */
                <div className="space-y-4">
                  <div>
                    <span className={`inline-block text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                      selectedNode.difficulty.toLowerCase() === 'easy'   ? 'badge-easy' :
                      selectedNode.difficulty.toLowerCase() === 'hard'   ? 'badge-hard' : 'badge-medium'
                    }`}>{selectedNode.difficulty}</span>
                    <h4 className="text-base font-bold text-text-primary mt-2">{selectedNode.name}</h4>
                  </div>
                  <div>
                    <h5 className="text-[11px] text-text-muted uppercase tracking-wider font-bold mb-1">Description</h5>
                    <p className="text-xs text-text-secondary leading-relaxed">{selectedNode.description}</p>
                  </div>
                </div>
              )}

              {/* Detailed Material - the long-form field distinct from the short
                  description above, generated from the course's own uploaded
                  content. AI actions are teacher-only and always go through
                  coordinator approval before this text actually changes. */}
              <div className="border-t border-border pt-4">
                <h5 className="text-[11px] text-text-muted uppercase tracking-wider font-bold mb-1">
                  Detailed Material
                </h5>
                {selectedNode.material && selectedNode.material.trim() ? (
                  <p className="text-xs text-text-secondary leading-relaxed whitespace-pre-wrap max-h-64 overflow-y-auto">
                    {selectedNode.material}
                  </p>
                ) : (
                  <p className="text-xs text-text-muted italic">No detailed material yet.</p>
                )}
                {isTeacher && (
                  <div className="mt-3 space-y-2">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleGenerateMaterial}
                        disabled={materialBusy}
                        className="flex-1 py-1.5 btn-secondary justify-center text-[11px] disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        {materialBusy ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                        {materialBusy ? 'Working…' : 'Generate material'}
                      </button>
                      {selectedNode.material && selectedNode.material.trim() && (
                        <button
                          type="button"
                          onClick={() => setMaterialRefineOpen((v) => !v)}
                          disabled={materialBusy}
                          className="flex-1 py-1.5 btn-secondary justify-center text-[11px] disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          <Sparkles className="w-3 h-3" />
                          Refine with AI
                        </button>
                      )}
                    </div>
                    {materialRefineOpen && (
                      <form onSubmit={handleEditMaterial} className="space-y-2">
                        <textarea
                          rows={2}
                          placeholder="e.g. add a worked example, simplify the second paragraph…"
                          className="input-light text-xs resize-none"
                          value={materialInstruction}
                          onChange={(e) => setMaterialInstruction(e.target.value)}
                        />
                        <button
                          type="submit"
                          disabled={materialBusy || !materialInstruction.trim()}
                          className="w-full py-1.5 btn-primary justify-center text-[11px] disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          {materialBusy ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                          {materialBusy ? 'Submitting…' : 'Submit refinement'}
                        </button>
                      </form>
                    )}
                  </div>
                )}
              </div>

              {/* Course Learning Outcomes this concept addresses - the Concept ->
                  CLO -> PLO -> GA outcome chain's entry point (see app/outcomes/*
                  on the backend). CLOs have no creation UI elsewhere in the app,
                  so auto-extracting from the outline is the only way to get them
                  onto a subject short of the raw API. */}
              {clos.length === 0 && isTeacher ? (
                <div className="border-t border-border pt-4">
                  <h4 className="text-xs font-bold text-text-secondary mb-2">Course Learning Outcomes</h4>
                  <p className="text-xs text-text-muted mb-2">
                    No CLOs defined yet for this subject.
                  </p>
                  <button
                    type="button"
                    onClick={handleAutoExtractClos}
                    disabled={autoExtractingClos}
                    className="w-full py-1.5 btn-secondary justify-center text-[11px] disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {autoExtractingClos ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                    {autoExtractingClos ? 'Extracting…' : 'Auto-extract CLOs from outline'}
                  </button>
                  {cloExtractMsg && <p className="text-[11px] text-text-muted mt-1.5">{cloExtractMsg}</p>}
                </div>
              ) : clos.length > 0 && (
                <div className="border-t border-border pt-4">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-xs font-bold text-text-secondary">
                      Addresses CLOs ({(conceptCloMap[selectedNode.id] || []).length})
                    </h4>
                    {isTeacher && (
                      <button
                        type="button"
                        onClick={handleAutoExtractClos}
                        disabled={autoExtractingClos}
                        title="Re-scan the outline for any new CLOs and tag untagged concepts"
                        className="text-text-muted hover:text-primary disabled:opacity-60"
                      >
                        {autoExtractingClos ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                      </button>
                    )}
                  </div>
                  {cloExtractMsg && <p className="text-[11px] text-text-muted mb-2">{cloExtractMsg}</p>}
                  {isTeacher ? (
                    <div className="space-y-1.5">
                      {clos.map((clo) => {
                        const checked = (conceptCloMap[selectedNode.id] || []).includes(clo.id);
                        return (
                          <label key={clo.id} className="flex items-start gap-2 text-xs text-text-secondary cursor-pointer">
                            <input
                              type="checkbox"
                              className="mt-0.5"
                              checked={checked}
                              disabled={savingConceptClos}
                              onChange={async (e) => {
                                const current = conceptCloMap[selectedNode.id] || [];
                                const next = e.target.checked
                                  ? [...current, clo.id]
                                  : current.filter((id) => id !== clo.id);
                                setSavingConceptClos(true);
                                try {
                                  if (catalogId) {
                                    await outcomesService.setConceptCLOs(catalogId, selectedNode.id, selectedNode.name, next);
                                  }
                                  setConceptCloMap((prev) => ({ ...prev, [selectedNode.id]: next }));
                                } catch (err) {
                                  setError(apiErrorMessage(err, 'Could not update this concept\'s CLO links.'));
                                } finally {
                                  setSavingConceptClos(false);
                                }
                              }}
                            />
                            <span>
                              <span className="font-bold">{clo.code}</span> — {clo.title}
                              {clo.plo_ids.length > 0 && (
                                <span className="ml-1.5 inline-flex flex-wrap gap-1">
                                  {clo.plo_ids.map((ploId) => {
                                    const p = plos.find((x) => x.id === ploId);
                                    return p ? (
                                      <span key={ploId} className="text-[10px] font-semibold rounded-full px-1.5 py-0.5 border text-secondary bg-secondary-muted border-secondary/20">
                                        {p.code}
                                      </span>
                                    ) : null;
                                  })}
                                </span>
                              )}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  ) : (conceptCloMap[selectedNode.id] || []).length === 0 ? (
                    <p className="text-xs text-text-muted italic">No learning outcomes linked yet.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {(conceptCloMap[selectedNode.id] || []).map((cloId) => {
                        const clo = clos.find((c) => c.id === cloId);
                        if (!clo) return null;
                        return (
                          <React.Fragment key={cloId}>
                            <span className="text-[11px] font-semibold rounded-full px-2 py-0.5 border text-primary bg-primary-muted border-primary/20">
                              {clo.code}
                            </span>
                            {clo.plo_ids.map((ploId) => {
                              const p = plos.find((x) => x.id === ploId);
                              return p ? (
                                <span key={ploId} className="text-[11px] font-semibold rounded-full px-2 py-0.5 border text-secondary bg-secondary-muted border-secondary/20">
                                  {p.code}
                                </span>
                              ) : null;
                            })}
                          </React.Fragment>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Prerequisites Chain */}
              <div className="border-t border-border pt-4">
                <h4 className="text-xs font-bold text-text-secondary mb-3">
                  Prerequisites Required ({prerequisites.length})
                </h4>
                {prerequisites.length === 0 ? (
                  <p className="text-xs text-text-muted italic">No prerequisites — introductory concept.</p>
                ) : (
                  <div className="space-y-2">
                    {prerequisites.map(prereq => (
                      <div
                        key={prereq.id}
                        className="bg-background border border-border rounded-xl p-2.5 flex items-center justify-between"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                          <span className="text-xs font-medium text-text-primary truncate">{prereq.name}</span>
                        </div>
                        {isTeacher && (
                          <button
                            onClick={() => handleDeleteRelationship(prereq.sourceId, prereq.targetId)}
                            disabled={removingLinkId === `${prereq.sourceId}->${prereq.targetId}`}
                            className="p-1 hover:bg-rose-50 text-text-muted hover:text-rose-500 rounded transition-all shrink-0 ml-2 disabled:opacity-50"
                            title="Remove prerequisite"
                          >
                            {removingLinkId === `${prereq.sourceId}->${prereq.targetId}`
                              ? <RefreshCw className="w-3 h-3 animate-spin" />
                              : <Trash2 className="w-3 h-3" />}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── MODAL: Add Concept (Teacher) ── */}
      {showNodeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/20 backdrop-blur-sm">
          <div className="w-full max-w-md bg-surface rounded-2xl shadow-hover border border-border overflow-hidden animate-fade-up">
            <div className="px-6 py-4 border-b border-border bg-background flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 bg-primary-muted rounded-lg flex items-center justify-center">
                  <Plus className="w-3.5 h-3.5 text-primary" />
                </div>
                <h3 className="text-sm font-bold text-text-primary">Add Concept Node</h3>
              </div>
              <button onClick={() => setShowNodeModal(false)} className="p-1 text-text-muted hover:text-text-primary rounded-lg">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreateNode} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1.5">Concept Name *</label>
                <input required placeholder="e.g. Logic Gates" className="input-light" value={newName} onChange={e => setNewName(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1.5">Difficulty</label>
                <select className="input-light" value={newDiff} onChange={e => setNewDiff(e.target.value)}>
                  <option>Easy</option><option>Medium</option><option>Hard</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1.5">Description *</label>
                <textarea required rows={3} placeholder="Describe what students learn..." className="input-light resize-none text-xs" value={newDesc} onChange={e => setNewDesc(e.target.value)} />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowNodeModal(false)} disabled={creatingNode} className="btn-ghost text-xs disabled:opacity-60">Cancel</button>
                <button type="submit" disabled={creatingNode} className="btn-primary text-xs disabled:opacity-60 disabled:cursor-not-allowed">
                  {creatingNode
                    ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Submitting…</>
                    : <><Plus className="w-3.5 h-3.5" /> Create Concept</>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL: Link Prerequisite (Teacher) ── */}
      {showEdgeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/20 backdrop-blur-sm">
          <div className="w-full max-w-md bg-surface rounded-2xl shadow-hover border border-border overflow-hidden animate-fade-up">
            <div className="px-6 py-4 border-b border-border bg-background flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 bg-secondary-muted rounded-lg flex items-center justify-center">
                  <LinkIcon className="w-3.5 h-3.5 text-secondary" />
                </div>
                <h3 className="text-sm font-bold text-text-primary">Link Prerequisite</h3>
              </div>
              <button onClick={() => setShowEdgeModal(false)} className="p-1 text-text-muted hover:text-text-primary rounded-lg">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreateEdge} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1.5">Prerequisite Concept (must be learned first)</label>
                <select required className="input-light" value={sourceName} onChange={e => setSourceName(e.target.value)}>
                  <option value="">— Select Concept —</option>
                  {concepts.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-3 text-text-muted text-xs font-medium">
                <div className="flex-1 h-px bg-border" />
                <span className="flex items-center gap-1"><Zap className="w-3.5 h-3.5 text-primary" /> is prerequisite of</span>
                <div className="flex-1 h-px bg-border" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1.5">Dependent Concept (requires the above)</label>
                <select required className="input-light" value={targetName} onChange={e => setTargetName(e.target.value)}>
                  <option value="">— Select Concept —</option>
                  {concepts.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowEdgeModal(false)} disabled={creatingEdge} className="btn-ghost text-xs disabled:opacity-60">Cancel</button>
                <button type="submit" disabled={creatingEdge} className="btn-primary text-xs disabled:opacity-60 disabled:cursor-not-allowed">
                  {creatingEdge
                    ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Submitting…</>
                    : <><LinkIcon className="w-3.5 h-3.5" /> Establish Link</>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

// Wrap with ReactFlowProvider to allow useReactFlow() hook
// Exported wrapper providing the React Flow context.
const KnowledgeGraph: React.FC = () => (
  <ReactFlowProvider>
    <KnowledgeGraphInner />
  </ReactFlowProvider>
);

export default KnowledgeGraph;
