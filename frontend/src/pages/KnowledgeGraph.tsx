import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Connection,
  type Edge,
  type Node,
  MarkerType,
  useReactFlow,
  ReactFlowProvider,
} from 'reactflow';
import 'reactflow/dist/style.css';

import { useAuth } from '../context/AuthContext';
import { graphService, courseService } from '../services/api';
import {
  ArrowLeft, RefreshCw, Plus, Link as LinkIcon, Save, Info,
  Trash2, AlertCircle, CheckCircle2, Search, BarChart3,
  X, BookOpen, Zap, ChevronDown, ChevronUp
} from 'lucide-react';

interface Concept {
  id: string;
  name: string;
  description: string;
  difficulty: string;
  course_id: number;
}

// ── Node Difficulty → Light Theme Badge Classes ──
const getDifficultyStyles = (difficulty: string) => {
  switch (difficulty.toLowerCase()) {
    case 'easy':   return { border: 'border-emerald-400', badge: 'badge-easy',   glow: 'shadow-emerald-100' };
    case 'hard':   return { border: 'border-rose-400',    badge: 'badge-hard',    glow: 'shadow-rose-100' };
    default:       return { border: 'border-amber-400',   badge: 'badge-medium',  glow: 'shadow-amber-100' };
  }
};

// ── Inner component that uses useReactFlow ──
const KnowledgeGraphInner: React.FC = () => {
  const { courseId } = useParams<{ courseId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { fitView, setCenter } = useReactFlow();

  const idNum = parseInt(courseId || '0');
  const isTeacher = user?.role === 'teacher';

  const [courseName, setCourseName] = useState('');
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Search
  const [searchQuery, setSearchQuery] = useState('');
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  // Analytics panel
  const [showAnalytics, setShowAnalytics] = useState(false);

  // Selected Node Side Panel
  const [selectedNode, setSelectedNode] = useState<Concept | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editDiff, setEditDiff] = useState('Medium');
  const [updatingNode, setUpdatingNode] = useState(false);

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
  const applyLevelLayout = useCallback((nodesList: any[], edgesList: any[]) => {
    const adj: Record<string, string[]> = {};
    const inDegree: Record<string, number> = {};
    nodesList.forEach(n => { adj[n.id] = []; inDegree[n.id] = 0; });
    edgesList.forEach(e => {
      if (adj[e.source]) {
        adj[e.source].push(e.target);
        inDegree[e.target] = (inDegree[e.target] || 0) + 1;
      }
    });

    const levels: Record<string, number> = {};
    const queue: string[] = [];
    nodesList.forEach(n => {
      if (inDegree[n.id] === 0) { levels[n.id] = 0; queue.push(n.id); }
    });
    while (queue.length > 0) {
      const u = queue.shift()!;
      adj[u].forEach(v => {
        levels[v] = Math.max(levels[v] || 0, levels[u] + 1);
        queue.push(v);
      });
    }

    const levelGroups: Record<number, string[]> = {};
    nodesList.forEach(n => {
      const lvl = levels[n.id] || 0;
      if (!levelGroups[lvl]) levelGroups[lvl] = [];
      levelGroups[lvl].push(n.id);
    });

    const hSpacing = 300;
    const vSpacing = 140;

    return nodesList.map(node => {
      const lvl = levels[node.id] || 0;
      const group = levelGroups[lvl];
      const idx = group.indexOf(node.id);
      const groupH = (group.length - 1) * vSpacing;
      return {
        ...node,
        position: {
          x: lvl * hSpacing + 60,
          y: idx * vSpacing - groupH / 2 + 300,
        }
      };
    });
  }, []);

  // ── Load Graph Data ──
  const loadGraphData = async () => {
    try {
      setLoading(true);
      setError('');
      const courseData = await courseService.getDetails(idNum);
      setCourseName(courseData.name);
      const data = await graphService.getGraph(idNum);
      setConcepts(data.nodes);

      const flowNodes: Node[] = data.nodes.map((concept: any) => {
        const styles = getDifficultyStyles(concept.difficulty);
        return {
          id: concept.id,
          data: {
            label: (
              <div className="text-left p-1">
                <span className={`inline-block text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full mb-1 ${
                  concept.difficulty.toLowerCase() === 'easy'   ? 'bg-emerald-100 text-emerald-700' :
                  concept.difficulty.toLowerCase() === 'hard'   ? 'bg-rose-100 text-rose-700' :
                                                                   'bg-amber-100 text-amber-700'
                }`}>{concept.difficulty}</span>
                <h4 className="font-bold text-xs text-slate-800 leading-tight line-clamp-1">{concept.name}</h4>
                <p className="text-[10px] text-slate-500 line-clamp-2 mt-0.5 leading-normal">{concept.description}</p>
              </div>
            ),
            concept,
          },
          type: 'default',
          position: { x: 0, y: 0 },
          className: `bg-white border-2 ${styles.border} rounded-xl w-52 shadow-md ${styles.glow} hover:shadow-lg hover:scale-[1.02] transition-all cursor-pointer`,
        };
      });

      const flowEdges: Edge[] = data.edges.map((edge: any) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        animated: true,
        markerEnd: { type: MarkerType.ArrowClosed, color: '#4f46e5' },
        style: { strokeWidth: 2, stroke: '#4f46e5' },
      }));

      const structured = applyLevelLayout(flowNodes, flowEdges);
      setNodes(structured);
      setEdges(flowEdges);
    } catch {
      setError('Could not load graph data. Ensure the backend is running.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (idNum) loadGraphData(); }, [courseId]);

  // ── Auto-clear alerts ──
  useEffect(() => {
    if (success) { const t = setTimeout(() => setSuccess(''), 4000); return () => clearTimeout(t); }
  }, [success]);
  useEffect(() => {
    if (error)   { const t = setTimeout(() => setError(''), 6000);   return () => clearTimeout(t); }
  }, [error]);

  // ── Node Click ──
  const onNodeClick = (_: React.MouseEvent, node: Node) => {
    const concept = concepts.find(c => c.id === node.id);
    if (concept) {
      setSelectedNode(concept);
      setEditName(concept.name);
      setEditDesc(concept.description);
      setEditDiff(concept.difficulty);
    }
  };

  // ── Search ──
  const filteredConcepts = useMemo(() => {
    if (!searchQuery.trim()) return [];
    return concepts.filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [searchQuery, concepts]);

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
  const handleUpdateNode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedNode) return;
    setUpdatingNode(true);
    try {
      await graphService.updateNode(idNum, selectedNode.id, { name: editName, description: editDesc, difficulty: editDiff });
      setSuccess(`"${editName}" updated successfully.`);
      setSelectedNode(null);
      loadGraphData();
    } catch {
      setError('Failed to update concept.');
    } finally {
      setUpdatingNode(false);
    }
  };

  // ── Delete Node ──
  const handleDeleteNode = async () => {
    if (!selectedNode) return;
    if (!window.confirm(`Delete concept "${selectedNode.name}"? All prerequisite links will also be removed.`)) return;
    try {
      await graphService.deleteNode(idNum, selectedNode.id);
      setSuccess(`"${selectedNode.name}" deleted.`);
      setSelectedNode(null);
      loadGraphData();
    } catch {
      setError('Failed to delete concept.');
    }
  };

  // ── Create Node ──
  const handleCreateNode = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await graphService.createPrerequisite(newName, newName, idNum);
      const nodeId = `${idNum}_${newName.toLowerCase().trim().replace(/ /g, '_')}`;
      await graphService.updateNode(idNum, nodeId, { description: newDesc, difficulty: newDiff });
      setSuccess(`Concept "${newName}" added.`);
      setNewName(''); setNewDesc(''); setNewDiff('Medium');
      setShowNodeModal(false);
      loadGraphData();
    } catch {
      setError('Failed to create concept node.');
    }
  };

  // ── Create Edge ──
  const handleCreateEdge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sourceName === targetName) { setError('A concept cannot be its own prerequisite.'); return; }
    try {
      await graphService.createPrerequisite(sourceName, targetName, idNum);
      setSuccess(`Linked: "${sourceName}" → "${targetName}"`);
      setSourceName(''); setTargetName('');
      setShowEdgeModal(false);
      loadGraphData();
    } catch {
      setError('Failed to link prerequisite.');
    }
  };

  // ── Delete Relationship ──
  const handleDeleteRelationship = async (sourceId: string, targetId: string) => {
    if (!window.confirm('Remove this prerequisite connection?')) return;
    try {
      await graphService.deleteRelationship(idNum, sourceId, targetId);
      setSuccess('Prerequisite link removed.');
      loadGraphData();
    } catch {
      setError('Failed to delete connection.');
    }
  };

  // ── Prerequisites of selected node ──
  const prerequisites = useMemo(() => {
    if (!selectedNode) return [];
    return edges
      .filter(e => e.target === selectedNode.id)
      .map(e => {
        const src = concepts.find(c => c.id === e.source);
        return { id: e.id, sourceId: e.source, targetId: e.target, name: src?.name ?? 'Unknown' };
      });
  }, [selectedNode, edges, concepts]);

  // ── Graph Analytics ──
  const analytics = useMemo(() => {
    const easy   = concepts.filter(c => c.difficulty.toLowerCase() === 'easy').length;
    const medium = concepts.filter(c => c.difficulty.toLowerCase() === 'medium').length;
    const hard   = concepts.filter(c => c.difficulty.toLowerCase() === 'hard').length;
    const total  = concepts.length || 1;
    return { easy, medium, hard, total: concepts.length, edgeCount: edges.length, easy_pct: Math.round(easy/total*100), med_pct: Math.round(medium/total*100), hard_pct: Math.round(hard/total*100) };
  }, [concepts, edges]);

  return (
    <div className="h-screen w-screen bg-background flex flex-col overflow-hidden">

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
              <span className="gradient-text">Knowledge Graph</span>
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
          {/* Search Dropdown */}
          {filteredConcepts.length > 0 && (
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
                    <span className="ml-auto text-[10px] text-text-muted">{c.difficulty}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Action Toolbar */}
        <div className="flex items-center gap-2">
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

          <button
            onClick={loadGraphData}
            className="p-2 border border-border text-text-secondary hover:text-primary hover:bg-primary-muted rounded-lg transition-all"
            title="Refresh graph"
          >
            <RefreshCw className="w-3.5 h-3.5" />
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
              <div className="flex items-center gap-3 text-[10px] text-text-muted shrink-0">
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

        {/* React Flow */}
        <div className="flex-1 h-full">
          {loading ? (
            <div className="h-full flex flex-col items-center justify-center gap-4">
              <div className="w-16 h-16 bg-primary-muted rounded-2xl flex items-center justify-center">
                <RefreshCw className="w-8 h-8 text-primary animate-spin" />
              </div>
              <p className="text-text-secondary text-sm">Loading knowledge structures...</p>
            </div>
          ) : (
            <ReactFlow
              nodes={nodes.map(n => ({
                ...n,
                className: `${n.className} ${n.id === highlightedId ? 'ring-2 ring-primary ring-offset-2 scale-105' : ''}`,
              }))}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeClick={onNodeClick}
              fitView
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
          )}
        </div>

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
                    <button type="submit" disabled={updatingNode}
                      className="flex-1 py-2 btn-primary justify-center text-xs">
                      <Save className="w-3.5 h-3.5" />
                      {updatingNode ? 'Saving...' : 'Save Changes'}
                    </button>
                    <button type="button" onClick={handleDeleteNode}
                      className="p-2 border border-rose-200 hover:border-rose-400 hover:bg-rose-50 text-rose-400 rounded-lg transition-all">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </form>
              ) : (
                /* Student: Read-Only View */
                <div className="space-y-4">
                  <div>
                    <span className={`inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                      selectedNode.difficulty.toLowerCase() === 'easy'   ? 'badge-easy' :
                      selectedNode.difficulty.toLowerCase() === 'hard'   ? 'badge-hard' : 'badge-medium'
                    }`}>{selectedNode.difficulty}</span>
                    <h4 className="text-base font-bold text-text-primary mt-2">{selectedNode.name}</h4>
                  </div>
                  <div>
                    <h5 className="text-[10px] text-text-muted uppercase tracking-wider font-bold mb-1">Description</h5>
                    <p className="text-xs text-text-secondary leading-relaxed">{selectedNode.description}</p>
                  </div>
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
                            className="p-1 hover:bg-rose-50 text-text-muted hover:text-rose-500 rounded transition-all shrink-0 ml-2"
                            title="Remove prerequisite"
                          >
                            <Trash2 className="w-3 h-3" />
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
                <button type="button" onClick={() => setShowNodeModal(false)} className="btn-ghost text-xs">Cancel</button>
                <button type="submit" className="btn-primary text-xs"><Plus className="w-3.5 h-3.5" /> Create Concept</button>
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
                <button type="button" onClick={() => setShowEdgeModal(false)} className="btn-ghost text-xs">Cancel</button>
                <button type="submit" className="btn-primary text-xs"><LinkIcon className="w-3.5 h-3.5" /> Establish Link</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

// Wrap with ReactFlowProvider to allow useReactFlow() hook
const KnowledgeGraph: React.FC = () => (
  <ReactFlowProvider>
    <KnowledgeGraphInner />
  </ReactFlowProvider>
);

export default KnowledgeGraph;
