import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Link, useParams } from 'react-router';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Brain, ArrowLeft, Target, CheckCircle, TrendingUp, ShieldCheck } from 'lucide-react';
import { supervisionService } from '../services/supervisionService';
import type { AiContent } from '../types/supervision';
import { ContentTypeBadge } from '../components/supervision/SupervisionBadges';

export function AdaptiveLearningPage() {
  const { courseId } = useParams();
  const [approvedContent, setApprovedContent] = useState<AiContent[]>([]);

  useEffect(() => {
    supervisionService
      .getStudentApprovedContent({ course_id: courseId })
      .then(setApprovedContent)
      .catch(() => setApprovedContent([]));
  }, [courseId]);

  const flashcards = approvedContent.filter((c) => c.content_type === 'flashcard');
  const studyGuides = approvedContent.filter((c) => c.content_type === 'study_guide');
  const quizzes = approvedContent.filter((c) => c.content_type === 'quiz');

  const missions = [
    ...flashcards.slice(0, 1).map((c) => ({
      task: `Review ${c.title}`,
      time: '15 min',
      type: 'flashcards',
      id: c.id,
    })),
    ...quizzes.slice(0, 1).map((c) => ({
      task: `Practice ${c.title}`,
      time: '20 min',
      type: 'quiz',
      id: c.id,
    })),
    ...studyGuides.slice(0, 1).map((c) => ({
      task: `Study ${c.title}`,
      time: '25 min',
      type: 'guide',
      id: c.id,
    })),
  ];

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border bg-card/50 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-6 py-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" asChild>
              <Link to={`/student/course/${courseId ?? 'course_dsa_101'}`}>
                <ArrowLeft className="w-5 h-5" />
              </Link>
            </Button>
            <div>
              <h1 className="text-xl font-bold">Your Adaptive Learning Path</h1>
              <p className="text-sm text-muted-foreground flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-[#22C55E]" />
                Built from teacher-approved AI materials only
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        <Card className="p-8 bg-gradient-to-br from-primary/10 via-transparent to-secondary/5 border-primary/20">
          <div className="flex items-start gap-4 mb-6">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center">
              <Target className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-bold mb-2">Today's Learning Mission</h2>
              <p className="text-muted-foreground">Complete these approved activities to stay on track</p>
            </div>
          </div>

          {missions.length === 0 ? (
            <Card className="p-6 text-center text-muted-foreground bg-card/80">
              No approved adaptive materials yet. Check back after your teacher completes AI supervision.
            </Card>
          ) : (
            <div className="grid md:grid-cols-3 gap-4">
              {missions.map((item) => (
                <Card key={item.id} className="p-4 bg-card/80">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs px-2 py-1 rounded-full bg-primary/10 text-primary">{item.type}</span>
                    <span className="text-xs text-muted-foreground">{item.time}</span>
                  </div>
                  <h4 className="font-semibold mb-3">{item.task}</h4>
                  <Button size="sm" className="w-full">Start</Button>
                </Card>
              ))}
            </div>
          )}
        </Card>

        {approvedContent.length > 0 && (
          <div>
            <h2 className="text-2xl font-bold mb-6">Approved Learning Resources</h2>
            <div className="grid md:grid-cols-2 gap-4">
              {approvedContent.map((item) => (
                <Card key={item.id} className="p-5 bg-card/50">
                  <ContentTypeBadge type={item.content_type} />
                  <h3 className="font-semibold mt-2 mb-1">{item.title}</h3>
                  <p className="text-sm text-muted-foreground line-clamp-2">
                    {item.body.summary || item.body.instructions}
                  </p>
                </Card>
              ))}
            </div>
          </div>
        )}

        <div>
          <h2 className="text-2xl font-bold mb-6">Your Learning Journey</h2>
          <div className="space-y-4">
            {[
              { week: 'This Week', focus: 'Graph Algorithms', progress: 60, status: 'active' },
              { week: 'Next Week', focus: 'Dynamic Programming', progress: 0, status: 'upcoming' },
            ].map((item, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }}>
                <Card className={`p-6 ${item.status === 'upcoming' ? 'opacity-70' : ''} bg-card/50`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      {item.status === 'active' ? (
                        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                          <TrendingUp className="w-5 h-5 text-primary" />
                        </div>
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                          <Brain className="w-5 h-5 text-muted-foreground" />
                        </div>
                      )}
                      <div>
                        <div className="text-sm text-muted-foreground">{item.week}</div>
                        <div className="font-semibold">{item.focus}</div>
                      </div>
                    </div>
                    {item.status === 'active' && (
                      <div className="flex items-center gap-2 text-sm">
                        <CheckCircle className="w-4 h-4 text-[#22C55E]" />
                        {item.progress}% complete
                      </div>
                    )}
                  </div>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
