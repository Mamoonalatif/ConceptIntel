import { motion } from 'motion/react';
import { Link } from 'react-router';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Progress } from '../components/ui/progress';
import { Brain, Upload, FileText, CheckCircle, Loader, ArrowLeft, Sparkles } from 'lucide-react';
import { useState } from 'react';

const mockFiles = [
  { name: 'Lecture_01_Introduction.pdf', size: '2.4 MB', status: 'completed', concepts: 12 },
  { name: 'Chapter_03_DataStructures.pdf', size: '5.8 MB', status: 'processing', concepts: 0 },
  { name: 'TextBook_Algorithms.pdf', size: '15.2 MB', status: 'pending', concepts: 0 },
];

export function ContentUploadPage() {
  const [files] = useState(mockFiles);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card/50 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon" asChild>
                <Link to="/teacher/dashboard">
                  <ArrowLeft className="w-5 h-5" />
                </Link>
              </Button>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center">
                  <Brain className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h1 className="text-xl font-bold">Upload Course Content</h1>
                  <p className="text-sm text-muted-foreground">AI will extract concepts automatically</p>
                </div>
              </div>
            </div>
            <Button asChild>
              <Link to="/teacher/course/1/knowledge-graph">
                View Knowledge Graph →
              </Link>
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-8"
        >
          {/* Upload Zone */}
          <Card className="p-12 bg-gradient-to-br from-primary/5 via-transparent to-secondary/5 border-2 border-dashed border-primary/30 hover:border-primary/50 transition-colors cursor-pointer">
            <div className="text-center">
              <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center">
                <Upload className="w-10 h-10 text-primary" />
              </div>
              <h2 className="text-2xl font-bold mb-2">Drag & Drop Your Content</h2>
              <p className="text-muted-foreground mb-6">
                Upload PDFs, slides, textbooks, or reference materials
              </p>
              <div className="flex items-center justify-center gap-4">
                <Button size="lg">
                  <Upload className="w-4 h-4 mr-2" />
                  Choose Files
                </Button>
                <span className="text-sm text-muted-foreground">or drag files here</span>
              </div>
              <p className="text-xs text-muted-foreground mt-4">
                Supports PDF, DOCX, PPTX • Max 100MB per file
              </p>
            </div>
          </Card>

          {/* AI Processing Info */}
          <Card className="p-6 bg-card/50 backdrop-blur-sm border-primary/20">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center flex-shrink-0">
                <Sparkles className="w-6 h-6 text-white" />
              </div>
              <div>
                <h3 className="font-semibold mb-2">AI-Powered Concept Extraction</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Our AI analyzes your content to identify key concepts, relationships, and prerequisites. 
                  It automatically generates knowledge graphs and suggests optimal learning paths.
                </p>
              </div>
            </div>
          </Card>

          {/* Uploaded Files */}
          <div>
            <h2 className="text-2xl font-bold mb-4">Uploaded Content</h2>
            
            <div className="space-y-4">
              {files.map((file, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.1 }}
                >
                  <Card className="p-6 bg-card/50 backdrop-blur-sm border-border/50 hover:shadow-lg transition-shadow">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center flex-shrink-0">
                        <FileText className="w-6 h-6 text-primary" />
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-2">
                          <h3 className="font-semibold truncate">{file.name}</h3>
                          <span className="text-sm text-muted-foreground flex-shrink-0 ml-4">{file.size}</span>
                        </div>
                        
                        {file.status === 'completed' && (
                          <div className="flex items-center gap-4">
                            <div className="flex items-center gap-2 text-[#22C55E]">
                              <CheckCircle className="w-4 h-4" />
                              <span className="text-sm font-medium">Extraction Complete</span>
                            </div>
                            <span className="text-sm text-muted-foreground">
                              {file.concepts} concepts identified
                            </span>
                          </div>
                        )}
                        
                        {file.status === 'processing' && (
                          <div className="space-y-2">
                            <div className="flex items-center gap-2">
                              <Loader className="w-4 h-4 animate-spin text-primary" />
                              <span className="text-sm text-primary font-medium">AI is analyzing content...</span>
                            </div>
                            <Progress value={65} className="h-1.5" />
                          </div>
                        )}
                        
                        {file.status === 'pending' && (
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <div className="w-4 h-4 rounded-full border-2 border-muted-foreground" />
                            <span className="text-sm">Waiting in queue</span>
                          </div>
                        )}
                      </div>
                      
                      {file.status === 'completed' && (
                        <Button variant="outline" size="sm">
                          View Concepts
                        </Button>
                      )}
                    </div>

                    {file.status === 'completed' && (
                      <div className="mt-4 pt-4 border-t border-border">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                          <Sparkles className="w-4 h-4" />
                          <span>AI-Generated Concepts Preview:</span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {['Binary Trees', 'Graph Theory', 'Sorting Algorithms', 'Dynamic Programming', 'Complexity Analysis'].map((concept, j) => (
                            <span key={j} className="px-3 py-1 rounded-full bg-primary/10 text-primary text-sm">
                              {concept}
                            </span>
                          ))}
                          <span className="px-3 py-1 rounded-full bg-muted text-muted-foreground text-sm">
                            +7 more
                          </span>
                        </div>
                      </div>
                    )}
                  </Card>
                </motion.div>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between pt-4">
            <Button variant="outline">
              Cancel Upload
            </Button>
            <Button size="lg">
              Continue to Knowledge Graph
            </Button>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
