import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import {
  ArrowLeft,
  CheckCircle,
  History,
  RefreshCw,
  Save,
  ScrollText,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { ContentTypeBadge, StatusBadge, formatDate } from '../components/supervision/SupervisionBadges';
import { supervisionService } from '../services/supervisionService';
import type { ContentBody, ContentDetail } from '../types/supervision';

interface ContentReviewPageProps {
  basePath?: '/teacher' | '/coordinator';
}

export function ContentReviewPage({ basePath = '/teacher' }: ContentReviewPageProps) {
  const { contentId } = useParams();
  const navigate = useNavigate();
  const [content, setContent] = useState<ContentDetail | null>(null);
  const [title, setTitle] = useState('');
  const [bodyJson, setBodyJson] = useState('');
  const [editNote, setEditNote] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [approveComment, setApproveComment] = useState('');
  const [regenInstructions, setRegenInstructions] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!contentId) return;
    setLoading(true);
    try {
      const data = await supervisionService.getContent(contentId);
      setContent(data);
      setTitle(data.title);
      setBodyJson(JSON.stringify(data.body, null, 2));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load content');
    } finally {
      setLoading(false);
    }
  }, [contentId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSaveEdit = async () => {
    if (!contentId) return;
    setSaving(true);
    try {
      const parsed = JSON.parse(bodyJson) as ContentBody;
      await supervisionService.editContent(contentId, {
        title,
        body: parsed,
        edit_note: editNote || 'Teacher edited AI-generated content',
      });
      toast.success('Content updated and sent back for review');
      load();
      setEditNote('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save edits');
    } finally {
      setSaving(false);
    }
  };

  const handleApprove = async () => {
    if (!contentId) return;
    setSaving(true);
    try {
      await supervisionService.approve(contentId, approveComment || undefined);
      toast.success('Content approved — now visible to students');
      navigate(`${basePath}/supervision`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Approval failed');
    } finally {
      setSaving(false);
    }
  };

  const handleReject = async () => {
    if (!contentId || rejectReason.trim().length < 3) {
      toast.error('Please provide a rejection reason');
      return;
    }
    setSaving(true);
    try {
      await supervisionService.reject(contentId, rejectReason);
      toast.success('Content rejected');
      navigate(`${basePath}/supervision`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Rejection failed');
    } finally {
      setSaving(false);
    }
  };

  const handleRegenerate = async () => {
    if (!contentId) return;
    setSaving(true);
    try {
      await supervisionService.regenerate(contentId, regenInstructions || undefined);
      toast.success('AI content regenerated — pending review');
      load();
      setRegenInstructions('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Regeneration failed');
    } finally {
      setSaving(false);
    }
  };

  if (loading || !content) {
    return (
      <div className="max-w-7xl mx-auto px-6 py-16 text-center text-muted-foreground">
        {loading ? 'Loading content review...' : 'Content not found'}
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-8">
      <div className="flex items-center gap-4 mb-8">
        <Button variant="ghost" size="icon" asChild>
          <Link to={`${basePath}/supervision`}>
            <ArrowLeft className="w-5 h-5" />
          </Link>
        </Button>
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <ContentTypeBadge type={content.content_type} />
            <StatusBadge status={content.status} />
            <span className="text-xs text-muted-foreground">Version {content.version}</span>
          </div>
          <h1 className="text-2xl font-bold">{content.title}</h1>
          <p className="text-sm text-muted-foreground">{content.course_name} · {content.teacher_name}</p>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <Card className="p-6">
            <h2 className="font-semibold mb-4">Edit AI-Generated Content</h2>
            <div className="space-y-4">
              <div>
                <Label htmlFor="title">Title</Label>
                <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="body">Content JSON (questions, cards, sections, etc.)</Label>
                <Textarea
                  id="body"
                  value={bodyJson}
                  onChange={(e) => setBodyJson(e.target.value)}
                  rows={14}
                  className="font-mono text-sm"
                />
              </div>
              <div>
                <Label htmlFor="editNote">Edit note (saved in revision history)</Label>
                <Input
                  id="editNote"
                  value={editNote}
                  onChange={(e) => setEditNote(e.target.value)}
                  placeholder="Describe what you changed..."
                />
              </div>
              <Button onClick={handleSaveEdit} disabled={saving}>
                <Save className="w-4 h-4 mr-2" />
                Save Edits
              </Button>
            </div>
          </Card>

          <Card className="p-6">
            <h2 className="font-semibold mb-4">Preview</h2>
            <div className="space-y-3 text-sm">
              {content.body.summary && <p>{content.body.summary}</p>}
              {content.body.instructions && (
                <div className="p-3 rounded-xl bg-muted/50">
                  <p className="font-medium mb-1">Instructions</p>
                  <p className="whitespace-pre-wrap">{content.body.instructions}</p>
                </div>
              )}
              {content.body.questions?.map((q, i) => (
                <div key={i} className="p-3 rounded-xl border border-border">
                  <p className="font-medium">{i + 1}. {q.question}</p>
                  {q.options && (
                    <ul className="mt-2 text-muted-foreground list-disc ml-5">
                      {q.options.map((opt) => (
                        <li key={opt}>{opt}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
              {content.body.cards?.map((card, i) => (
                <div key={i} className="p-3 rounded-xl border border-border">
                  <p><span className="font-medium">Front:</span> {card.front}</p>
                  <p><span className="font-medium">Back:</span> {card.back}</p>
                </div>
              ))}
              {content.body.sections?.map((section, i) => (
                <div key={i} className="p-3 rounded-xl border border-border">
                  <p className="font-medium">{section.heading}</p>
                  <p className="text-muted-foreground">{section.content}</p>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="p-6 bg-gradient-to-br from-primary/10 to-secondary/5 border-primary/20">
            <h3 className="font-semibold mb-4">AI Analysis</h3>
            <div className="text-center mb-4">
              <div className="text-4xl font-bold text-primary">
                {Math.round((content.body.ai_confidence ?? 0.85) * 100)}%
              </div>
              <p className="text-xs text-muted-foreground">AI Confidence</p>
            </div>
            {content.body.ai_notes && (
              <p className="text-sm text-muted-foreground">{content.body.ai_notes}</p>
            )}
          </Card>

          <Card className="p-6 space-y-4">
            <h3 className="font-semibold">Review Actions</h3>
            <div>
              <Label>Approval comment (optional)</Label>
              <Textarea value={approveComment} onChange={(e) => setApproveComment(e.target.value)} rows={2} />
            </div>
            <Button className="w-full" onClick={handleApprove} disabled={saving}>
              <CheckCircle className="w-4 h-4 mr-2" />
              Approve for Students
            </Button>
            <div>
              <Label>Rejection reason</Label>
              <Textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} rows={2} />
            </div>
            <Button variant="outline" className="w-full text-destructive" onClick={handleReject} disabled={saving}>
              <XCircle className="w-4 h-4 mr-2" />
              Reject
            </Button>
            <div>
              <Label>Regeneration instructions</Label>
              <Textarea
                value={regenInstructions}
                onChange={(e) => setRegenInstructions(e.target.value)}
                rows={2}
                placeholder="e.g. Add more CLO-aligned questions on BFS..."
              />
            </div>
            <Button variant="secondary" className="w-full" onClick={handleRegenerate} disabled={saving}>
              <Sparkles className="w-4 h-4 mr-2" />
              Regenerate with AI
            </Button>
          </Card>

          <Tabs defaultValue="approvals">
            <TabsList className="w-full">
              <TabsTrigger value="approvals" className="flex-1">
                <History className="w-4 h-4 mr-1" />
                Approvals
              </TabsTrigger>
              <TabsTrigger value="revisions" className="flex-1">
                <ScrollText className="w-4 h-4 mr-1" />
                Revisions
              </TabsTrigger>
            </TabsList>
            <TabsContent value="approvals">
              <Card className="p-4 space-y-3 max-h-72 overflow-y-auto">
                {content.approvals.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No approval history yet</p>
                ) : (
                  content.approvals.map((record) => (
                    <div key={record.id} className="text-sm p-3 rounded-xl bg-muted/40">
                      <div className="flex justify-between gap-2">
                        <span className="font-medium capitalize">{record.action}</span>
                        <span className="text-xs text-muted-foreground">{formatDate(record.created_at)}</span>
                      </div>
                      <p className="text-muted-foreground">{record.reviewer_name} ({record.reviewer_role})</p>
                      {record.comment && <p className="mt-1">{record.comment}</p>}
                      <p className="text-xs mt-1">{record.previous_status} → {record.new_status}</p>
                    </div>
                  ))
                )}
              </Card>
            </TabsContent>
            <TabsContent value="revisions">
              <Card className="p-4 space-y-3 max-h-72 overflow-y-auto">
                {content.revisions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No revisions yet</p>
                ) : (
                  content.revisions.map((rev) => (
                    <div key={rev.id} className="text-sm p-3 rounded-xl bg-muted/40">
                      <div className="flex justify-between gap-2">
                        <span className="font-medium">Version {rev.version}</span>
                        <span className="text-xs text-muted-foreground">{formatDate(rev.created_at)}</span>
                      </div>
                      <p className="text-muted-foreground">{rev.edited_by_name}</p>
                      {rev.edit_note && <p className="mt-1">{rev.edit_note}</p>}
                    </div>
                  ))
                )}
              </Card>
            </TabsContent>
          </Tabs>

          <Button variant="ghost" className="w-full" onClick={load}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>
    </div>
  );
}
