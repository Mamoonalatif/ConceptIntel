import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Brain, Save, Undo, Redo } from 'lucide-react';
import { Link } from 'react-router';

export function KnowledgeGraphSupervisionPage() {
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
              <h3 className="font-semibold mb-4">Pending Approvals</h3>
              <div className="space-y-2 text-sm">
                <div className="p-3 rounded-xl bg-muted/30">
                  <div className="font-medium">Dr. Smith</div>
                  <div className="text-muted-foreground text-xs">Added 3 concepts</div>
                </div>
                <div className="p-3 rounded-xl bg-muted/30">
                  <div className="font-medium">Prof. Johnson</div>
                  <div className="text-muted-foreground text-xs">Modified relationships</div>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
