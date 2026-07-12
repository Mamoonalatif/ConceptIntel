import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { BookOpen, Pencil, Plus, Trash2, X } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { courseCatalogService } from '../services/courseService';
import type { CourseCatalogEntry } from '../types/course';

const NONE_PREREQ = '__none__';

/**
 * HOD's course-catalog management screen. This is deliberately NOT the
 * course-creation wizard — HOD decides whether a course exists in the
 * program at all (name, code, prerequisite mapping, assigned coordinator).
 * They never create or see scheduled "classes"/offerings — that's the
 * Teacher's job.
 */
export function CatalogManagementPage() {
  const [catalog, setCatalog] = useState<CourseCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [addingCourse, setAddingCourse] = useState(false);
  const [newCourse, setNewCourse] = useState({ name: '', code: '', prerequisiteId: '' });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState({ name: '', code: '', prerequisiteId: '' });

  const refresh = () => courseCatalogService.getAll().then(setCatalog);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, []);

  const submitNewCourse = async () => {
    if (!newCourse.name.trim() || !newCourse.code.trim()) return;
    await courseCatalogService.add({
      name: newCourse.name.trim(),
      code: newCourse.code.trim().toUpperCase(),
      prerequisiteId: newCourse.prerequisiteId || null,
      coordinatorId: null,
      coordinatorName: null,
    });
    toast.success('Course added to the catalog');
    setAddingCourse(false);
    setNewCourse({ name: '', code: '', prerequisiteId: '' });
    refresh();
  };

  const startEditing = (entry: CourseCatalogEntry) => {
    setEditingId(entry.id);
    setEditValues({
      name: entry.name,
      code: entry.code,
      prerequisiteId: entry.prerequisiteId ?? '',
    });
  };

  const saveEdits = async (id: string) => {
    await courseCatalogService.update(id, {
      name: editValues.name.trim(),
      code: editValues.code.trim().toUpperCase(),
      prerequisiteId: editValues.prerequisiteId || null,
    });
    toast.success('Course updated');
    setEditingId(null);
    refresh();
  };

  const handleDelete = async (entry: CourseCatalogEntry) => {
    if (!confirm(`Remove "${entry.name}" from the catalog? This cannot be undone.`)) return;
    const ok = await courseCatalogService.delete(entry.id);
    if (ok) {
      toast.success('Course removed from the catalog');
      refresh();
    } else {
      toast.error('This course is part of the fixed program scope and cannot be removed');
    }
  };

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 md:px-6 py-8">
        <p className="text-muted-foreground">Loading course catalog…</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 md:px-6 py-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold">Course Catalog</h1>
          <p className="text-muted-foreground mt-1">
            Decide which courses exist in the program — Teachers can only create classes for
            courses listed here
          </p>
        </div>
        <Button onClick={() => setAddingCourse((v) => !v)}>
          <Plus className="w-4 h-4 mr-2" />
          Add New Course
        </Button>
      </div>

      {addingCourse && (
        <Card className="p-6 mb-6 border-dashed border-primary/40 bg-primary/5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">New Course</h3>
            <button type="button" onClick={() => setAddingCourse(false)}>
              <X className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>
          <div className="grid sm:grid-cols-2 gap-3 mb-3">
            <Input
              placeholder="Course name"
              value={newCourse.name}
              onChange={(e) => setNewCourse((n) => ({ ...n, name: e.target.value }))}
            />
            <Input
              placeholder="Course code (e.g., CS201)"
              value={newCourse.code}
              onChange={(e) => setNewCourse((n) => ({ ...n, code: e.target.value }))}
            />
          </div>
          <Select
            value={newCourse.prerequisiteId}
            onValueChange={(v) => setNewCourse((n) => ({ ...n, prerequisiteId: v }))}
          >
            <SelectTrigger className="mb-3">
              <SelectValue placeholder="Prerequisite (optional)" />
            </SelectTrigger>
            <SelectContent>
              {catalog.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={submitNewCourse}>
            Save Course
          </Button>
        </Card>
      )}

      <div className="space-y-4">
        {catalog.map((entry, i) => (
          <motion.div key={entry.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
            <Card className="p-6 bg-card/50 backdrop-blur-sm">
              {editingId === entry.id ? (
                <div className="space-y-3">
                  <div className="grid sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Course Name</Label>
                      <Input
                        value={editValues.name}
                        onChange={(e) => setEditValues((v) => ({ ...v, name: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Course Code</Label>
                      <Input
                        value={editValues.code}
                        onChange={(e) => setEditValues((v) => ({ ...v, code: e.target.value.toUpperCase() }))}
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Prerequisite</Label>
                    <Select
                      value={editValues.prerequisiteId || NONE_PREREQ}
                      onValueChange={(v) =>
                        setEditValues((val) => ({ ...val, prerequisiteId: v === NONE_PREREQ ? '' : v }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE_PREREQ}>None</SelectItem>
                        {catalog
                          .filter((c) => c.id !== entry.id)
                          .map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => saveEdits(entry.id)}>
                      Save
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                      <BookOpen className="w-6 h-6 text-primary" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold">{entry.name}</h3>
                      <div className="flex flex-wrap gap-2 mt-2">
                        <Badge variant="outline" className="font-mono">{entry.code}</Badge>
                        <Badge variant="outline">
                          Prerequisite: {catalog.find((c) => c.id === entry.prerequisiteId)?.name ?? 'None'}
                        </Badge>
                        <Badge variant="outline">Coordinator: {entry.coordinatorName ?? 'Unassigned'}</Badge>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button size="sm" variant="outline" onClick={() => startEditing(entry)}>
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => handleDelete(entry)}>
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
