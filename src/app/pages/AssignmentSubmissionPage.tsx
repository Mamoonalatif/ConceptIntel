import { motion } from 'motion/react';
import { Link } from 'react-router';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Textarea } from '../components/ui/textarea';
import { ArrowLeft, Upload, FileText, CheckCircle, AlertTriangle, Sparkles } from 'lucide-react';
import { useState } from 'react';

export function AssignmentSubmissionPage() {
  const [feedback] = useState({
    grade: 88,
    strengths: ['Clear problem-solving approach', 'Well-commented code', 'Good time complexity analysis'],
    weaknesses: ['Graph traversal implementation could be optimized', 'Edge case handling needs work'],
    concepts: [
      { name: 'Graph Theory', mastery: 72 },
      { name: 'DFS Algorithm', mastery: 68 },
      { name: 'Time Complexity', mastery: 85 },
    ]
  });

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border bg-card/50 backdrop-blur-sm">
        <div className="max-w-5xl mx-auto px-6 py-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" asChild>
              <Link to="/student/course/1">
                <ArrowLeft className="w-5 h-5" />
              </Link>
            </Button>
            <div>
              <h1 className="text-xl font-bold">Assignment 3: Graph Algorithms</h1>
              <p className="text-sm text-muted-foreground">Data Structures & Algorithms</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="grid lg:grid-cols-2 gap-8">
          {/* Submission */}
          <div className="space-y-6">
            <Card className="p-6 bg-card/50">
              <h2 className="text-xl font-bold mb-4">Your Submission</h2>
              
              <div className="space-y-4">
                <div className="border-2 border-dashed border-border rounded-xl p-8 text-center hover:border-primary/50 transition-colors cursor-pointer">
                  <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Click to upload or drag and drop</p>
                  <p className="text-xs text-muted-foreground mt-1">PDF, DOCX up to 10MB</p>
                </div>

                <div className="p-4 rounded-xl bg-muted/30 flex items-center gap-3">
                  <FileText className="w-8 h-8 text-primary" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">Assignment3_Solution.pdf</div>
                    <div className="text-sm text-muted-foreground">2.4 MB</div>
                  </div>
                  <CheckCircle className="w-5 h-5 text-[#22C55E]" />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">Additional Notes</label>
                  <Textarea placeholder="Add any comments or notes for your teacher..." rows={4} />
                </div>

                <Button className="w-full" size="lg">Submit Assignment</Button>
              </div>
            </Card>

            <Card className="p-6 bg-card/50">
              <h3 className="font-semibold mb-4">Assignment Details</h3>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Due Date</span>
                  <span className="font-medium">May 15, 2026</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Time Left</span>
                  <span className="font-medium text-[#F59E0B]">2 days</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Max Points</span>
                  <span className="font-medium">100</span>
                </div>
              </div>
            </Card>
          </div>

          {/* AI Feedback */}
          <div className="space-y-6">
            <Card className="p-6 bg-gradient-to-br from-primary/10 via-transparent to-secondary/5 border-primary/20">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center">
                  <Sparkles className="w-5 h-5 text-white" />
                </div>
                <h2 className="text-xl font-bold">AI Feedback</h2>
              </div>

              <div className="text-center mb-6">
                <div className="text-6xl font-bold bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent mb-2">
                  {feedback.grade}%
                </div>
                <div className="text-sm text-muted-foreground">Your Score</div>
              </div>

              <div className="space-y-6">
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <CheckCircle className="w-5 h-5 text-[#22C55E]" />
                    <h3 className="font-semibold">Strengths</h3>
                  </div>
                  <ul className="space-y-2">
                    {feedback.strengths.map((item, i) => (
                      <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                        <span className="text-[#22C55E]">✓</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <AlertTriangle className="w-5 h-5 text-[#F59E0B]" />
                    <h3 className="font-semibold">Areas for Improvement</h3>
                  </div>
                  <ul className="space-y-2">
                    {feedback.weaknesses.map((item, i) => (
                      <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                        <span className="text-[#F59E0B]">!</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </Card>

            <Card className="p-6 bg-card/50">
              <h3 className="font-semibold mb-4">Concept Analysis</h3>
              <div className="space-y-3">
                {feedback.concepts.map((concept, i) => (
                  <div key={i}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium">{concept.name}</span>
                      <span className="text-sm font-semibold">{concept.mastery}%</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${concept.mastery}%` }}
                        transition={{ duration: 1, delay: i * 0.2 }}
                        className={`h-full ${
                          concept.mastery >= 70 ? 'bg-[#22C55E]' :
                          concept.mastery >= 50 ? 'bg-[#F59E0B]' : 'bg-[#EF4444]'
                        }`}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="p-6 bg-card/50">
              <h3 className="font-semibold mb-3">Recommended Actions</h3>
              <div className="space-y-2">
                <Button variant="outline" size="sm" className="w-full justify-start">
                  Practice Graph Traversal Problems
                </Button>
                <Button variant="outline" size="sm" className="w-full justify-start">
                  Review DFS Implementation
                </Button>
                <Button variant="outline" size="sm" className="w-full justify-start">
                  Study Edge Case Handling
                </Button>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
