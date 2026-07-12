import { motion } from 'motion/react';
import { Link } from 'react-router';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Textarea } from '../components/ui/textarea';
import { ArrowLeft, FileText, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';

const submissions = [
  { id: 1, student: 'John Doe', submitted: '2h ago', aiScore: 88, status: 'pending' },
  { id: 2, student: 'Jane Smith', submitted: '5h ago', aiScore: 92, status: 'pending' },
  { id: 3, student: 'Mike Johnson', submitted: '1d ago', aiScore: 75, status: 'reviewed' },
];

export function AssignmentEvaluationPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border bg-card/50 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" asChild>
              <Link to="/teacher/dashboard">
                <ArrowLeft className="w-5 h-5" />
              </Link>
            </Button>
            <div>
              <h1 className="text-xl font-bold">Assignment Evaluation</h1>
              <p className="text-sm text-muted-foreground">DSA Assignment 3 - Graph Algorithms</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="grid lg:grid-cols-3 gap-8">
          {/* Submissions List */}
          <div className="lg:col-span-2">
            <Card className="bg-card/50">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Student</TableHead>
                    <TableHead>Submitted</TableHead>
                    <TableHead>AI Score</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {submissions.map((sub) => (
                    <TableRow key={sub.id}>
                      <TableCell className="font-medium">{sub.student}</TableCell>
                      <TableCell>{sub.submitted}</TableCell>
                      <TableCell>
                        <span className={`font-semibold ${
                          sub.aiScore >= 80 ? 'text-[#22C55E]' :
                          sub.aiScore >= 60 ? 'text-[#F59E0B]' : 'text-[#EF4444]'
                        }`}>
                          {sub.aiScore}%
                        </span>
                      </TableCell>
                      <TableCell>
                        {sub.status === 'pending' ? (
                          <span className="text-xs px-2 py-1 rounded-full bg-[#F59E0B]/10 text-[#F59E0B]">
                            Pending
                          </span>
                        ) : (
                          <span className="text-xs px-2 py-1 rounded-full bg-[#22C55E]/10 text-[#22C55E]">
                            Reviewed
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button size="sm">Review</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>

            {/* Selected Submission View */}
            <Card className="p-6 mt-6 bg-card/50">
              <h3 className="font-semibold mb-4">Submission Preview</h3>
              <div className="aspect-[4/3] bg-muted rounded-xl flex items-center justify-center mb-4">
                <FileText className="w-12 h-12 text-muted-foreground" />
              </div>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Teacher Feedback</label>
                  <Textarea placeholder="Provide detailed feedback..." rows={4} />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">Final Grade</label>
                  <input
                    type="number"
                    placeholder="Enter grade (0-100)"
                    className="w-full px-4 py-2 rounded-xl border border-border bg-input-background"
                  />
                </div>

                <div className="flex gap-3">
                  <Button className="flex-1">
                    <CheckCircle className="w-4 h-4 mr-2" />
                    Approve
                  </Button>
                  <Button variant="outline" className="flex-1">
                    Request Revision
                  </Button>
                </div>
              </div>
            </Card>
          </div>

          {/* AI Analysis Sidebar */}
          <div className="space-y-6">
            <Card className="p-6 bg-gradient-to-br from-primary/10 via-transparent to-secondary/5 border-primary/20">
              <h3 className="font-semibold mb-4">AI Analysis</h3>
              
              <div className="text-center mb-6">
                <div className="text-5xl font-bold text-primary mb-2">88%</div>
                <div className="text-sm text-muted-foreground">AI Confidence Score</div>
              </div>

              <div className="space-y-4">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle className="w-4 h-4 text-[#22C55E]" />
                    <span className="text-sm font-medium">Strengths</span>
                  </div>
                  <ul className="text-xs text-muted-foreground space-y-1 ml-6">
                    <li>• Clear implementation</li>
                    <li>• Good time complexity</li>
                  </ul>
                </div>

                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="w-4 h-4 text-[#F59E0B]" />
                    <span className="text-sm font-medium">Issues Found</span>
                  </div>
                  <ul className="text-xs text-muted-foreground space-y-1 ml-6">
                    <li>• Missing edge cases</li>
                    <li>• Optimization possible</li>
                  </ul>
                </div>

                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <XCircle className="w-4 h-4 text-[#EF4444]" />
                    <span className="text-sm font-medium">Plagiarism Check</span>
                  </div>
                  <div className="text-xs text-[#22C55E] ml-6">
                    ✓ No issues detected (98% original)
                  </div>
                </div>
              </div>
            </Card>

            <Card className="p-6 bg-card/50">
              <h3 className="font-semibold mb-4">Concept Mastery</h3>
              <div className="space-y-3">
                {[
                  { name: 'Graph Theory', score: 85 },
                  { name: 'DFS/BFS', score: 72 },
                  { name: 'Complexity', score: 90 },
                ].map((concept, i) => (
                  <div key={i}>
                    <div className="flex justify-between text-sm mb-1">
                      <span>{concept.name}</span>
                      <span className="font-semibold">{concept.score}%</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full ${
                          concept.score >= 80 ? 'bg-[#22C55E]' :
                          concept.score >= 60 ? 'bg-[#F59E0B]' : 'bg-[#EF4444]'
                        }`}
                        style={{ width: `${concept.score}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
