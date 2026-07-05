import { Sparkles, Loader, Plus, X, GripVertical, BookOpen } from 'lucide-react';
import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Card } from '../ui/card';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Switch } from '../ui/switch';
import { Badge } from '../ui/badge';
import type { CourseFormData, CourseModule } from '../../types/course';
import { courseService } from '../../services/courseService';

interface AiRoadmapStepProps {
  form: CourseFormData;
  onChange: (updates: Partial<CourseFormData>) => void;
}

export function AiRoadmapStep({ form, onChange }: AiRoadmapStepProps) {
  const [generating, setGenerating] = useState(false);
  const [newTopic, setNewTopic] = useState('');

  const handleAiGenerate = async () => {
    onChange({ aiAssisted: true });
    setGenerating(true);
    try {
      const result = await courseService.generateAiStructure({
        title: form.title,
        subject: form.subject,
        description: form.description,
        clos: form.clos,
        prerequisites: form.prerequisites,
      });
      onChange({
        modules: result.modules,
        clos: form.clos.length === 0 ? result.clos : form.clos,
        aiAssisted: true,
      });
    } finally {
      setGenerating(false);
    }
  };

  const addModule = () => {
    const mod: CourseModule = {
      id: `mod_${Date.now()}`,
      title: 'New Module',
      week: form.modules.length + 1,
      topics: [],
      duration: '1 week',
    };
    onChange({ modules: [...form.modules, mod] });
  };

  const updateModule = (id: string, updates: Partial<CourseModule>) => {
    onChange({
      modules: form.modules.map((m) => (m.id === id ? { ...m, ...updates } : m)),
    });
  };

  const removeModule = (id: string) => {
    onChange({ modules: form.modules.filter((m) => m.id !== id) });
  };

  return (
    <div className="space-y-6">
      <Card className="p-6 md:p-8 bg-gradient-to-br from-primary/10 via-transparent to-secondary/10 border-primary/20">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-5 h-5 text-primary" />
              <h2 className="text-2xl font-bold">AI-Assisted Course Setup</h2>
            </div>
            <p className="text-muted-foreground">
              Generate a structured course roadmap aligned with your CLOs using GPT-powered intelligence
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Label htmlFor="ai-toggle" className="text-sm">Enable AI</Label>
            <Switch
              id="ai-toggle"
              checked={form.aiAssisted}
              onCheckedChange={(v) => onChange({ aiAssisted: v })}
            />
          </div>
        </div>

        {form.aiAssisted && (
          <div className="mt-6">
            <Button onClick={handleAiGenerate} disabled={generating || !form.title}>
              {generating ? (
                <>
                  <Loader className="w-4 h-4 mr-2 animate-spin" />
                  Generating structure...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-2" />
                  Generate Course Roadmap
                </>
              )}
            </Button>
            {generating && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="mt-4 p-4 rounded-xl bg-primary/5 border border-primary/20"
              >
                <p className="text-sm text-primary animate-pulse">
                  Analyzing learning outcomes and building module structure...
                </p>
              </motion.div>
            )}
          </div>
        )}
      </Card>

      <Card className="p-6 md:p-8 bg-card/50 backdrop-blur-sm border-border/50">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-secondary" />
            <h2 className="text-xl font-bold">Course Roadmap Preview</h2>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={addModule}>
            <Plus className="w-4 h-4 mr-1" />
            Add Module
          </Button>
        </div>

        {form.modules.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <BookOpen className="w-12 h-12 mx-auto mb-3 opacity-40" />
            <p>No modules yet. Enable AI generation or add modules manually.</p>
          </div>
        ) : (
          <div className="relative">
            <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-primary/20 hidden md:block" />
            <AnimatePresence>
              {form.modules.map((mod, i) => (
                <motion.div
                  key={mod.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ delay: i * 0.05 }}
                  className="relative mb-4 last:mb-0"
                >
                  <div className="md:pl-10">
                    <div className="absolute left-2.5 top-6 w-3 h-3 rounded-full bg-primary border-2 border-background hidden md:block" />
                    <div className="p-4 rounded-xl border border-border bg-card/80 hover:border-primary/30 transition-colors">
                      <div className="flex items-start gap-3">
                        <GripVertical className="w-4 h-4 text-muted-foreground mt-2 shrink-0 hidden sm:block" />
                        <div className="flex-1 space-y-3">
                          <div className="flex flex-col sm:flex-row gap-3">
                            <Input
                              value={mod.title}
                              onChange={(e) => updateModule(mod.id, { title: e.target.value })}
                              className="font-semibold flex-1"
                            />
                            <Badge variant="outline" className="shrink-0 w-fit">
                              Week {mod.week}
                            </Badge>
                            <Badge variant="secondary" className="shrink-0 w-fit">
                              {mod.duration}
                            </Badge>
                          </div>
                          {mod.description && (
                            <p className="text-sm text-muted-foreground">{mod.description}</p>
                          )}
                          <div className="flex flex-wrap gap-2">
                            {mod.topics.map((topic, ti) => (
                              <Badge key={ti} className="bg-primary/10 text-primary border-primary/20">
                                {topic}
                                <button
                                  type="button"
                                  className="ml-1"
                                  onClick={() =>
                                    updateModule(mod.id, {
                                      topics: mod.topics.filter((_, idx) => idx !== ti),
                                    })
                                  }
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </Badge>
                            ))}
                            <div className="flex gap-1">
                              <Input
                                placeholder="Add topic"
                                value={newTopic}
                                onChange={(e) => setNewTopic(e.target.value)}
                                className="h-7 w-32 text-xs"
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && newTopic.trim()) {
                                    updateModule(mod.id, { topics: [...mod.topics, newTopic.trim()] });
                                    setNewTopic('');
                                  }
                                }}
                              />
                            </div>
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeModule(mod.id)}
                          className="shrink-0"
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </Card>
    </div>
  );
}
