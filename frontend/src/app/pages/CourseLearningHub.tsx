import { motion } from 'motion/react';
import { Link } from 'react-router';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Progress } from '../components/ui/progress';
import { Brain, ArrowLeft, BookOpen, FileText, Target, Play, CheckCircle } from 'lucide-react';

export function CourseLearningHub() {
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
                <h1 className="text-xl font-bold">Data Structures & Algorithms</h1>
                <p className="text-sm text-muted-foreground">Course Progress: 65%</p>
              </div>
            </div>
            <Button asChild>
              <Link to="/student/course/1/adaptive">
                <Target className="w-4 h-4 mr-2" />
                Adaptive Learning
              </Link>
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        <Tabs defaultValue="roadmap" className="space-y-6">
          <TabsList>
            <TabsTrigger value="roadmap">Roadmap</TabsTrigger>
            <TabsTrigger value="materials">Materials</TabsTrigger>
            <TabsTrigger value="assignments">Assignments</TabsTrigger>
            <TabsTrigger value="analytics">Analytics</TabsTrigger>
          </TabsList>

          <TabsContent value="roadmap" className="space-y-4">
            {[
              { week: 1, title: 'Arrays & Strings', status: 'completed', mastery: 85 },
              { week: 2, title: 'Linked Lists', status: 'completed', mastery: 72 },
              { week: 3, title: 'Stacks & Queues', status: 'in-progress', mastery: 48 },
              { week: 4, title: 'Trees & Graphs', status: 'locked', mastery: 0 },
            ].map((item, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.1 }}
              >
                <Card className={`p-6 ${item.status === 'locked' ? 'opacity-50' : ''} bg-card/50 backdrop-blur-sm`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4 flex-1">
                      <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                        item.status === 'completed' ? 'bg-[#22C55E]/10' :
                        item.status === 'in-progress' ? 'bg-primary/10' : 'bg-muted'
                      }`}>
                        {item.status === 'completed' && <CheckCircle className="w-6 h-6 text-[#22C55E]" />}
                        {item.status === 'in-progress' && <Play className="w-6 h-6 text-primary" />}
                        {item.status === 'locked' && <div className="w-4 h-4 border-2 border-muted-foreground rounded" />}
                      </div>
                      
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <span className="text-sm text-muted-foreground">Week {item.week}</span>
                          <h3 className="font-semibold">{item.title}</h3>
                        </div>
                        {item.status !== 'locked' && (
                          <div className="flex items-center gap-4">
                            <div className="flex-1 max-w-xs">
                              <Progress value={item.mastery} className="h-2" />
                            </div>
                            <span className="text-sm text-muted-foreground">{item.mastery}% Mastery</span>
                          </div>
                        )}
                      </div>
                    </div>
                    
                    {item.status !== 'locked' && (
                      <Button>{item.status === 'completed' ? 'Review' : 'Continue'}</Button>
                    )}
                  </div>
                </Card>
              </motion.div>
            ))}
          </TabsContent>

          <TabsContent value="materials">
            <div className="grid md:grid-cols-3 gap-6">
              {['Lecture Slides', 'Video Lectures', 'Practice Problems', 'Reference Books', 'Code Examples', 'Quiz Bank'].map((item, i) => (
                <Card key={i} className="p-6 hover:shadow-lg transition-shadow cursor-pointer bg-card/50">
                  <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
                    <FileText className="w-6 h-6 text-primary" />
                  </div>
                  <h3 className="font-semibold mb-2">{item}</h3>
                  <p className="text-sm text-muted-foreground">15 resources</p>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="assignments">
            <div className="space-y-4">
              {[
                { title: 'Assignment 1: Arrays', due: 'Completed', grade: 95 },
                { title: 'Assignment 2: Linked Lists', due: 'Completed', grade: 88 },
                { title: 'Assignment 3: Stacks & Queues', due: '3 days left', grade: null },
              ].map((assignment, i) => (
                <Card key={i} className="p-6 bg-card/50">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold mb-1">{assignment.title}</h3>
                      <p className="text-sm text-muted-foreground">{assignment.due}</p>
                    </div>
                    {assignment.grade ? (
                      <div className="text-right">
                        <div className="text-2xl font-bold text-[#22C55E]">{assignment.grade}%</div>
                        <div className="text-sm text-muted-foreground">Grade</div>
                      </div>
                    ) : (
                      <Button>Submit</Button>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="analytics">
            <div className="grid md:grid-cols-3 gap-6">
              <Card className="p-6 bg-card/50">
                <div className="text-3xl font-bold mb-2">65%</div>
                <div className="text-sm text-muted-foreground">Overall Mastery</div>
              </Card>
              <Card className="p-6 bg-card/50">
                <div className="text-3xl font-bold mb-2">42</div>
                <div className="text-sm text-muted-foreground">Concepts Learned</div>
              </Card>
              <Card className="p-6 bg-card/50">
                <div className="text-3xl font-bold mb-2">18h</div>
                <div className="text-sm text-muted-foreground">Study Time</div>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
