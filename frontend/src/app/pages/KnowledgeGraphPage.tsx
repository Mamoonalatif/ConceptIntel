import { motion } from 'motion/react';
import { Link } from 'react-router';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Brain, ArrowLeft, ZoomIn, ZoomOut, Maximize, Download, Sparkles, Filter } from 'lucide-react';
import { useState } from 'react';

const nodes = [
  { id: 1, name: 'Arrays', x: 20, y: 30, mastery: 85, level: 1 },
  { id: 2, name: 'Linked Lists', x: 35, y: 25, mastery: 72, level: 1 },
  { id: 3, name: 'Stacks', x: 50, y: 20, mastery: 90, level: 2 },
  { id: 4, name: 'Queues', x: 50, y: 40, mastery: 68, level: 2 },
  { id: 5, name: 'Trees', x: 65, y: 30, mastery: 45, level: 3 },
  { id: 6, name: 'Graphs', x: 80, y: 35, mastery: 38, level: 4 },
  { id: 7, name: 'Hash Tables', x: 35, y: 50, mastery: 75, level: 2 },
  { id: 8, name: 'Heaps', x: 65, y: 50, mastery: 52, level: 3 },
];

const connections = [
  { from: 1, to: 2 },
  { from: 2, to: 3 },
  { from: 2, to: 4 },
  { from: 3, to: 5 },
  { from: 4, to: 5 },
  { from: 5, to: 6 },
  { from: 1, to: 7 },
  { from: 4, to: 8 },
  { from: 8, to: 6 },
];

export function KnowledgeGraphPage() {
  const [selectedNode, setSelectedNode] = useState<number | null>(null);

  const getNodeColor = (mastery: number) => {
    if (mastery >= 70) return '#22C55E';
    if (mastery >= 50) return '#F59E0B';
    return '#EF4444';
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card/50 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon" asChild>
                <Link to="/teacher/dashboard">
                  <ArrowLeft className="w-5 h-5" />
                </Link>
              </Button>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center">
                  <Brain className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h1 className="text-xl font-bold">Knowledge Graph</h1>
                  <p className="text-sm text-muted-foreground">Data Structures & Algorithms</p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button variant="outline" size="sm">
                <Filter className="w-4 h-4 mr-2" />
                Filters
              </Button>
              <Button variant="outline" size="sm">
                <Download className="w-4 h-4 mr-2" />
                Export
              </Button>
              <Button>Save Changes</Button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="grid lg:grid-cols-4 gap-8">
          {/* Main Graph View */}
          <div className="lg:col-span-3 space-y-6">
            {/* Graph Controls */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Button variant="outline" size="icon">
                  <ZoomIn className="w-4 h-4" />
                </Button>
                <Button variant="outline" size="icon">
                  <ZoomOut className="w-4 h-4" />
                </Button>
                <Button variant="outline" size="icon">
                  <Maximize className="w-4 h-4" />
                </Button>
              </div>

              <div className="flex items-center gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ background: '#22C55E' }} />
                  <span className="text-muted-foreground">High Mastery</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ background: '#F59E0B' }} />
                  <span className="text-muted-foreground">Medium Mastery</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ background: '#EF4444' }} />
                  <span className="text-muted-foreground">Needs Work</span>
                </div>
              </div>
            </div>

            {/* Graph Visualization */}
            <Card className="p-8 bg-card/50 backdrop-blur-sm border-border/50 relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-secondary/5" />

              <div className="relative h-[600px]">
                <svg className="w-full h-full">
                  {/* Draw connections */}
                  {connections.map((conn, i) => {
                    const fromNode = nodes.find(n => n.id === conn.from);
                    const toNode = nodes.find(n => n.id === conn.to);
                    if (!fromNode || !toNode) return null;

                    return (
                      <motion.line
                        key={i}
                        initial={{ pathLength: 0, opacity: 0 }}
                        animate={{ pathLength: 1, opacity: 0.3 }}
                        transition={{ duration: 1, delay: i * 0.1 }}
                        x1={`${fromNode.x}%`}
                        y1={`${fromNode.y}%`}
                        x2={`${toNode.x}%`}
                        y2={`${toNode.y}%`}
                        stroke="currentColor"
                        strokeWidth="2"
                        className="text-primary"
                      />
                    );
                  })}
                </svg>

                {/* Draw nodes */}
                {nodes.map((node, i) => (
                  <motion.div
                    key={node.id}
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ duration: 0.5, delay: i * 0.1 }}
                    style={{
                      position: 'absolute',
                      left: `${node.x}%`,
                      top: `${node.y}%`,
                      transform: 'translate(-50%, -50%)',
                    }}
                    onClick={() => setSelectedNode(node.id)}
                    className="cursor-pointer"
                  >
                    <motion.div
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.95 }}
                      className={`relative ${selectedNode === node.id ? 'z-10' : ''}`}
                    >
                      {/* Glow effect */}
                      <div
                        className="absolute inset-0 rounded-2xl blur-xl opacity-50"
                        style={{ background: getNodeColor(node.mastery) }}
                      />

                      {/* Node */}
                      <div
                        className="relative w-24 h-24 rounded-2xl flex flex-col items-center justify-center p-3 backdrop-blur-sm border-2 transition-all"
                        style={{
                          background: `${getNodeColor(node.mastery)}15`,
                          borderColor: selectedNode === node.id ? getNodeColor(node.mastery) : `${getNodeColor(node.mastery)}40`,
                        }}
                      >
                        <span className="text-xs font-semibold text-center leading-tight mb-1">
                          {node.name}
                        </span>
                        <span className="text-lg font-bold" style={{ color: getNodeColor(node.mastery) }}>
                          {node.mastery}%
                        </span>
                      </div>
                    </motion.div>
                  </motion.div>
                ))}
              </div>
            </Card>

            {/* AI Suggestions */}
            <Card className="p-6 bg-gradient-to-br from-primary/10 via-transparent to-secondary/5 border-primary/20">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center flex-shrink-0">
                  <Sparkles className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="font-semibold mb-2">AI Recommendations</h3>
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    <li className="flex items-start gap-2">
                      <span className="text-primary">•</span>
                      <span>Add prerequisite connection between "Hash Tables" and "Arrays"</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-secondary">•</span>
                      <span>Consider splitting "Trees" into sub-concepts: Binary Trees, BST, AVL Trees</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-primary">•</span>
                      <span>Students struggle with "Graphs" - add more foundational prerequisites</span>
                    </li>
                  </ul>
                </div>
              </div>
            </Card>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Selected Node Details */}
            {selectedNode && (
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
              >
                <Card className="p-6 bg-card/50 backdrop-blur-sm border-border/50">
                  <h3 className="font-semibold mb-4">Concept Details</h3>
                  {(() => {
                    const node = nodes.find(n => n.id === selectedNode);
                    if (!node) return null;
                    return (
                      <div className="space-y-4">
                        <div>
                          <div className="text-2xl font-bold mb-1">{node.name}</div>
                          <div className="text-sm text-muted-foreground">Level {node.level}</div>
                        </div>

                        <div>
                          <div className="flex items-center justify-between text-sm mb-2">
                            <span className="text-muted-foreground">Avg. Mastery</span>
                            <span className="font-semibold" style={{ color: getNodeColor(node.mastery) }}>
                              {node.mastery}%
                            </span>
                          </div>
                        </div>

                        <div className="space-y-2 pt-4 border-t border-border">
                          <Button variant="outline" size="sm" className="w-full">
                            Edit Concept
                          </Button>
                          <Button variant="outline" size="sm" className="w-full">
                            Add Relationships
                          </Button>
                          <Button variant="outline" size="sm" className="w-full text-destructive">
                            Remove Concept
                          </Button>
                        </div>
                      </div>
                    );
                  })()}
                </Card>
              </motion.div>
            )}

            {/* Graph Stats */}
            <Card className="p-6 bg-card/50 backdrop-blur-sm border-border/50">
              <h3 className="font-semibold mb-4">Graph Statistics</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Total Concepts</span>
                  <span className="font-semibold">{nodes.length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Connections</span>
                  <span className="font-semibold">{connections.length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Difficulty Levels</span>
                  <span className="font-semibold">4</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Coverage</span>
                  <span className="font-semibold text-[#22C55E]">92%</span>
                </div>
              </div>
            </Card>

            {/* Quick Actions */}
            <Card className="p-6 bg-card/50 backdrop-blur-sm border-border/50">
              <h3 className="font-semibold mb-4">Quick Actions</h3>
              <div className="space-y-2">
                <Button variant="outline" size="sm" className="w-full justify-start">
                  + Add Concept
                </Button>
                <Button variant="outline" size="sm" className="w-full justify-start">
                  Auto-organize Graph
                </Button>
                <Button variant="outline" size="sm" className="w-full justify-start">
                  Validate Prerequisites
                </Button>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
