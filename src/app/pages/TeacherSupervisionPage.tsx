import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import {
  Brain,
  CheckCircle,
  Clock,
  FileText,
  Filter,
  RefreshCw,
  ScrollText,
  XCircle,
} from 'lucide-react';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { ContentTypeBadge, StatusBadge, formatDate } from '../components/supervision/SupervisionBadges';
import { supervisionService } from '../services/supervisionService';
import type { AiContent, ContentStatus, ContentType, SupervisionStats, AuditLogEntry } from '../types/supervision';
import { useAuth } from '../context/AuthContext';

interface TeacherSupervisionPageProps {
  basePath?: '/teacher' | '/coordinator';
}

export function TeacherSupervisionPage({ basePath = '/teacher' }: TeacherSupervisionPageProps) {
  const { user } = useAuth();
  const [items, setItems] = useState<AiContent[]>([]);
  const [stats, setStats] = useState<SupervisionStats | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [statusFilter, setStatusFilter] = useState<ContentStatus | 'all'>('pending_review');
  const [typeFilter, setTypeFilter] = useState<ContentType | 'all'>('all');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [content, summary, logs] = await Promise.all([
        supervisionService.listContent({
          status: statusFilter === 'all' ? undefined : statusFilter,
          type: typeFilter === 'all' ? undefined : typeFilter,
        }),
        supervisionService.getStats(),
        supervisionService.getAuditLogs(20),
      ]);
      setItems(content);
      setStats(summary);
      setAuditLogs(logs);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load supervision queue');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, typeFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSeed = async () => {
    try {
      const result = await supervisionService.seedDemo();
      toast.success(result.seeded ? `Seeded ${result.seeded} demo items` : 'Demo content already exists');
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Seed failed');
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-8">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold mb-2">AI Content Supervision</h1>
            <p className="text-muted-foreground">
              {basePath === '/coordinator'
                ? 'Review, approve, and govern AI-generated curriculum content across courses'
                : 'Review, edit, approve, or reject AI-generated learning materials'}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={load} disabled={loading}>
              <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            {user?.role === 'teacher' && (
              <Button variant="outline" onClick={handleSeed}>
                Load Demo Content
              </Button>
            )}
          </div>
        </div>
      </motion.div>

      {stats && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {[
            { label: 'Pending Review', value: stats.pending_review, icon: Clock, color: 'text-[#F59E0B]' },
            { label: 'Approved', value: stats.approved, icon: CheckCircle, color: 'text-[#22C55E]' },
            { label: 'Rejected', value: stats.rejected, icon: XCircle, color: 'text-[#EF4444]' },
            { label: 'Total Items', value: stats.total, icon: FileText, color: 'text-primary' },
          ].map((stat) => (
            <Card key={stat.label} className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{stat.label}</p>
                  <p className="text-2xl font-bold">{stat.value}</p>
                </div>
                <stat.icon className={`w-8 h-8 ${stat.color}`} />
              </div>
            </Card>
          ))}
        </div>
      )}

      <Card className="p-4 mb-6">
        <div className="flex flex-col md:flex-row gap-4 items-start md:items-center">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Filter className="w-4 h-4" />
            Filters
          </div>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as ContentStatus | 'all')}>
            <SelectTrigger className="w-full md:w-48">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="pending_review">Pending Review</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as ContentType | 'all')}>
            <SelectTrigger className="w-full md:w-48">
              <SelectValue placeholder="Content type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="quiz">Quiz</SelectItem>
              <SelectItem value="assignment">Assignment</SelectItem>
              <SelectItem value="flashcard">Flashcards</SelectItem>
              <SelectItem value="study_guide">Study Guide</SelectItem>
              <SelectItem value="concept_map">Concept Map</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      {loading ? (
        <div className="text-center py-16 text-muted-foreground">Loading supervision queue...</div>
      ) : items.length === 0 ? (
        <Card className="p-12 text-center">
          <Brain className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
          <h3 className="font-semibold mb-2">No AI content in this queue</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Upload course materials or load demo content to start the review workflow.
          </p>
          {user?.role === 'teacher' && (
            <Button onClick={handleSeed}>Load Demo Content</Button>
          )}
        </Card>
      ) : (
        <div className="space-y-4">
          {items.map((item, i) => (
            <motion.div key={item.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
              <Card className="p-5 hover:shadow-md transition-shadow">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  <div className="space-y-2 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <ContentTypeBadge type={item.content_type} />
                      <StatusBadge status={item.status} />
                      <span className="text-xs text-muted-foreground">v{item.version}</span>
                    </div>
                    <h3 className="text-lg font-semibold">{item.title}</h3>
                    <p className="text-sm text-muted-foreground">{item.course_name}</p>
                    <p className="text-sm line-clamp-2">{item.body.summary || item.body.instructions || 'AI-generated content awaiting review'}</p>
                    <div className="flex flex-wrap gap-2">
                      {item.concept_tags.map((tag) => (
                        <span key={tag} className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                          {tag}
                        </span>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      By {item.teacher_name} · Updated {formatDate(item.updated_at)}
                    </p>
                  </div>
                  <Button asChild>
                    <Link to={`${basePath}/supervision/${item.id}`}>Review</Link>
                  </Button>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      )}

      <Card className="p-6 mt-8">
        <div className="flex items-center gap-2 mb-4">
          <ScrollText className="w-5 h-5 text-primary" />
          <h2 className="text-xl font-bold">Audit Log</h2>
        </div>
        {auditLogs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No supervision actions recorded yet.</p>
        ) : (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {auditLogs.map((log) => (
              <div key={log.id} className="text-sm p-3 rounded-xl bg-muted/40 flex justify-between gap-4">
                <div>
                  <span className="font-medium capitalize">{log.action.replace(/_/g, ' ')}</span>
                  <span className="text-muted-foreground"> · {log.actor_name} ({log.actor_role})</span>
                </div>
                <span className="text-xs text-muted-foreground shrink-0">{formatDate(log.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
