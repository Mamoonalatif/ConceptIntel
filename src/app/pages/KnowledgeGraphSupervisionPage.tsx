import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Brain, Save, Undo, Redo } from 'lucide-react';
import { supervisionService } from '../services/supervisionService';
import { ContentTypeBadge, StatusBadge } from '../components/supervision/SupervisionBadges';
import type { AiContent } from '../types/supervision';

export function KnowledgeGraphSupervisionPage() {
  const [pendingItems, setPendingItems] = useState<AiContent[]>([]);

  useEffect(() => {
    supervisionService
      .listContent({ status: 'pending_review' })
      .then(setPendingItems)
      .catch(() => setPendingItems([]));
  }, []);

  return (
    <div className="min-h-screen">
      <div className="border-b border-border bg-card/50 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="sm" asChild>
                <Link to="/coordinator/dashboard">← Back</Link>
              </Button>
              <div>
                <h1 className="text-xl font-bold">Knowledge Graph Supervision</h1>
                <p className="text-sm text-muted-foreground">Edit and validate curriculum graph</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button variant="outline" size="sm"><Undo className="w-4 h-4" /></Button>
              <Button variant="outline" size="sm"><Redo className="w-4 h-4" /></Button>
              <Button size="sm"><Save className="w-4 h-4 mr-2" />Save Changes</Button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="grid lg:grid-cols-4 gap-8">
          <div className="lg:col-span-3">
            <Card className="p-8 bg-card/50 h-[700px] flex items-center justify-center">
              <div className="text-center">
                <Brain className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
                <p className="text-muted-foreground">Interactive Knowledge Graph Editor</p>
                <p className="text-sm text-muted-foreground mt-2">
                  Drag-and-drop nodes, edit relationships, validate prerequisites
                </p>
              </div>
            </Card>
          </div>

          <div className="space-y-6">
            <Card className="p-6 bg-card/50">
              <h3 className="font-semibold mb-4">Graph Actions</h3>
              <div className="space-y-2">
                <Button variant="outline" size="sm" className="w-full justify-start">+ Add Concept</Button>
                <Button variant="outline" size="sm" className="w-full justify-start">+ Add Relationship</Button>
                <Button variant="outline" size="sm" className="w-full justify-start">Validate Graph</Button>
                <Button variant="outline" size="sm" className="w-full justify-start">Auto-organize</Button>
              </div>
            </Card>

            <Card className="p-6 bg-card/50">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold">Pending Approvals</h3>
                <Button variant="link" size="sm" asChild>
                  <Link to="/coordinator/supervision">View all</Link>
                </Button>
              </div>
              <div className="space-y-2 text-sm">
                {pendingItems.length === 0 ? (
                  <p className="text-muted-foreground">No pending AI content</p>
                ) : (
                  pendingItems.slice(0, 5).map((item) => (
                    <Link
                      key={item.id}
                      to={`/coordinator/supervision/${item.id}`}
                      className="block p-3 rounded-xl bg-muted/30 hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <ContentTypeBadge type={item.content_type} />
                        <StatusBadge status={item.status} />
                      </div>
                      <div className="font-medium">{item.title}</div>
                      <div className="text-muted-foreground text-xs">{item.teacher_name} · {item.course_name}</div>
                    </Link>
                  ))
                )}
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
