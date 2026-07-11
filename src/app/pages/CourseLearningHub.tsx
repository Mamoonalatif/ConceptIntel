import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Progress } from '../components/ui/progress';
import { Brain, ArrowLeft, BookOpen, FileText, Target, Play, CheckCircle, ShieldCheck } from 'lucide-react';
import { supervisionService } from '../services/supervisionService';
import { ContentTypeBadge } from '../components/supervision/SupervisionBadges';
import type { AiContent } from '../types/supervision';
import { contentTypeLabels } from '../types/supervision';

export function CourseLearningHub() {
  const { courseId } = useParams();
  const [approvedContent, setApprovedContent] = useState<AiContent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const items = await supervisionService.getStudentApprovedContent({
          course_id: courseId,
        });
        setApprovedContent(items);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to load approved materials');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [courseId]);

  const quizzes = approvedContent.filter((c) => c.content_type === 'quiz');
  const assignments = approvedContent.filter((c) => c.content_type === 'assignment');
  const materials = approvedContent.filter((c) =>
    ['flashcard', 'study_guide', 'lecture_note', 'concept_map'].includes(c.content_type)
  );

  const courseName = approvedContent[0]?.course_name ?? 'Data Structures & Algorithms';

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border bg-card/50 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon" asChild>
                <Link to="/student/dashboard">
                  <ArrowLeft className="w-5 h-5" />
                </Link>
              </Button>
              <div>
                <h1 className="text-xl font-bold">{courseName}</h1>
                <p className="text-sm text-muted-foreground flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5 text-[#22C55E]" />
                  Teacher-approved content only
                </p>
              </div>
            </div>
            <Button asChild>
              <Link to={`/student/course/${courseId ?? 'course_dsa_101'}/adaptive`}>
                <Target className="w-4 h-4 mr-2" />
                Adaptive Learning
              </Link>
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        <Tabs defaultValue="materials" className="space-y-6">
          <TabsList>
            <TabsTrigger value="materials">Approved Materials ({materials.length})</TabsTrigger>
            <TabsTrigger value="assignments">Assignments ({assignments.length})</TabsTrigger>
            <TabsTrigger value="quizzes">Quizzes ({quizzes.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="materials">
            {loading ? (
              <p className="text-muted-foreground">Loading approved materials...</p>
            ) : materials.length === 0 ? (
              <Card className="p-8 text-center text-muted-foreground">
                No approved study materials yet. Your teacher is reviewing AI-generated content.
              </Card>
            ) : (
              <div className="grid md:grid-cols-2 gap-6">
                {materials.map((item) => (
                  <Card key={item.id} className="p-6 bg-card/50">
                    <ContentTypeBadge type={item.content_type} />
                    <h3 className="font-semibold mt-3 mb-2">{item.title}</h3>
                    <p className="text-sm text-muted-foreground mb-3">{item.body.summary}</p>
                    <div className="flex flex-wrap gap-1">
                      {item.concept_tags.map((tag) => (
                        <span key={tag} className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">{tag}</span>
                      ))}
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="assignments">
            {assignments.length === 0 ? (
              <Card className="p-8 text-center text-muted-foreground">
                No approved assignments available yet.
              </Card>
            ) : (
              <div className="space-y-4">
                {assignments.map((item) => (
                  <Card key={item.id} className="p-6 bg-card/50">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <h3 className="font-semibold mb-1">{item.title}</h3>
                        <p className="text-sm text-muted-foreground">{item.body.instructions}</p>
                        <p className="text-xs text-[#22C55E] mt-2">Approved by {item.reviewed_by_name}</p>
                      </div>
                      <Button asChild>
                        <Link to={`/student/assignment/${item.id}/submit`}>Start</Link>
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="quizzes">
            {quizzes.length === 0 ? (
              <Card className="p-8 text-center text-muted-foreground">
                No approved quizzes available yet.
              </Card>
            ) : (
              <div className="space-y-4">
                {quizzes.map((item) => (
                  <Card key={item.id} className="p-6 bg-card/50">
                    <h3 className="font-semibold mb-2">{item.title}</h3>
                    <p className="text-sm text-muted-foreground mb-4">{item.body.summary}</p>
                    <p className="text-sm">{item.body.questions?.length ?? 0} questions · {contentTypeLabels.quiz}</p>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>

        {!loading && approvedContent.length > 0 && (
          <Card className="p-6 mt-8 bg-primary/5 border-primary/20">
            <div className="flex items-start gap-3">
              <ShieldCheck className="w-5 h-5 text-[#22C55E] shrink-0 mt-0.5" />
              <div>
                <h3 className="font-semibold mb-1">Teacher-supervised learning</h3>
                <p className="text-sm text-muted-foreground">
                  You only see content that teachers or coordinators have reviewed and approved.
                  Pending or rejected AI outputs are hidden until supervision is complete.
                </p>
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
