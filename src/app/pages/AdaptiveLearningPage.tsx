import { motion } from 'motion/react';
import { Link } from 'react-router';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Brain, ArrowLeft, Target, CheckCircle, TrendingUp, Calendar } from 'lucide-react';

export function AdaptiveLearningPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border bg-card/50 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-6 py-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" asChild>
              <Link to="/student/course/1">
                <ArrowLeft className="w-5 h-5" />
              </Link>
            </Button>
            <div>
              <h1 className="text-xl font-bold">Your Adaptive Learning Path</h1>
              <p className="text-sm text-muted-foreground">AI-personalized based on your progress</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        {/* Today's Mission */}
        <Card className="p-8 bg-gradient-to-br from-primary/10 via-transparent to-secondary/5 border-primary/20">
          <div className="flex items-start gap-4 mb-6">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center">
              <Target className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-bold mb-2">Today's Learning Mission</h2>
              <p className="text-muted-foreground">Complete these to stay on track</p>
            </div>
          </div>
          
          <div className="grid md:grid-cols-3 gap-4">
            {[
              { task: 'Review Graph Traversal', time: '15 min', type: 'review' },
              { task: 'Practice DFS Problems', time: '30 min', type: 'practice' },
              { task: 'Watch BFS Tutorial', time: '20 min', type: 'learn' },
            ].map((item, i) => (
              <Card key={i} className="p-4 bg-card/80">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs px-2 py-1 rounded-full bg-primary/10 text-primary">{item.type}</span>
                  <span className="text-xs text-muted-foreground">{item.time}</span>
                </div>
                <h4 className="font-semibold mb-3">{item.task}</h4>
                <Button size="sm" className="w-full">Start</Button>
              </Card>
            ))}
          </div>
        </Card>

        {/* Learning Timeline */}
        <div>
          <h2 className="text-2xl font-bold mb-6">Your Learning Journey</h2>
          <div className="space-y-4">
            {[
              { week: 'This Week', focus: 'Graph Algorithms', progress: 60, status: 'active' },
              { week: 'Next Week', focus: 'Dynamic Programming', progress: 0, status: 'upcoming' },
              { week: 'Week After', focus: 'Advanced Trees', progress: 0, status: 'upcoming' },
            ].map((item, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
              >
                <Card className={`p-6 ${item.status === 'upcoming' ? 'opacity-70' : ''} bg-card/50`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      {item.status === 'active' ? (
                        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                          <TrendingUp className="w-5 h-5 text-primary" />
                        </div>
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                          <Calendar className="w-5 h-5 text-muted-foreground" />
                        </div>
                      )}
                      <div>
                        <div className="text-sm text-muted-foreground">{item.week}</div>
                        <h3 className="font-semibold">{item.focus}</h3>
                      </div>
                    </div>
                    {item.status === 'active' && (
                      <div className="flex items-center gap-4">
                        <span className="text-sm text-muted-foreground">{item.progress}% Complete</span>
                        <Button>Continue</Button>
                      </div>
                    )}
                  </div>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Weak Concepts Focus */}
        <Card className="p-6 bg-card/50">
          <h2 className="text-2xl font-bold mb-6">Focus Areas (AI Recommended)</h2>
          <div className="grid md:grid-cols-2 gap-4">
            {[
              { concept: 'Graph Traversal', mastery: 45, priority: 'high' },
              { concept: 'Binary Search Trees', mastery: 52, priority: 'medium' },
              { concept: 'Hash Tables', mastery: 58, priority: 'medium' },
              { concept: 'Sorting Algorithms', mastery: 62, priority: 'low' },
            ].map((item, i) => (
              <div key={i} className="p-4 rounded-xl bg-[#EF4444]/5 border border-[#EF4444]/20">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium">{item.concept}</span>
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    item.priority === 'high' ? 'bg-[#EF4444]/10 text-[#EF4444]' :
                    item.priority === 'medium' ? 'bg-[#F59E0B]/10 text-[#F59E0B]' :
                    'bg-[#22C55E]/10 text-[#22C55E]'
                  }`}>
                    {item.priority}
                  </span>
                </div>
                <div className="text-sm text-muted-foreground mb-3">{item.mastery}% Mastery</div>
                <Button variant="outline" size="sm" className="w-full">Practice Now</Button>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
