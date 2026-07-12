import { useEffect, useState } from 'react';
import { Lock, Pencil, Plus, X } from 'lucide-react';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Card } from '../ui/card';
import type { CourseCatalogEntry, CourseFormData, UserCourseRole } from '../../types/course';
import { SEMESTERS } from '../../types/course';
import { courseCatalogService } from '../../services/courseService';

interface CourseDetailsStepProps {
  form: CourseFormData;
  onChange: (updates: Partial<CourseFormData>) => void;
  role: UserCourseRole;
}

const NONE_PREREQ = 'None';

export function CourseDetailsStep({ form, onChange, role }: CourseDetailsStepProps) {
  // Editing an existing catalog entry's name/code/prerequisite.
  const canManageCatalog = role === 'coordinator' || role === 'hod' || role === 'admin';
  // Growing the catalog with a brand new course is an HOD/Admin decision —
  // whether the degree/department needs more courses at all.
  const canExpandCatalog = role === 'hod' || role === 'admin';
  const [catalog, setCatalog] = useState<CourseCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingCatalog, setEditingCatalog] = useState(false);
  const [addingCourse, setAddingCourse] = useState(false);
  const [newCourse, setNewCourse] = useState({ name: '', code: '', prerequisiteId: '' });

  const refreshCatalog = async () => {
    const fresh = await courseCatalogService.getAll();
    setCatalog(fresh);
    return fresh;
  };

  useEffect(() => {
    courseCatalogService
      .getAll()
      .then(setCatalog)
      .finally(() => setLoading(false));
  }, []);

  const selectFromCatalog = (courseId: string, catalogList: CourseCatalogEntry[]) => {
    const entry = catalogList.find((c) => c.id === courseId);
    if (!entry) return;
    const prereqName = entry.prerequisiteId
      ? catalogList.find((c) => c.id === entry.prerequisiteId)?.name ?? NONE_PREREQ
      : NONE_PREREQ;
    onChange({
      courseId: entry.id,
      courseName: entry.name,
      courseCode: entry.code,
      prerequisite: prereqName,
    });
  };

  const applyCourseSelection = (courseId: string) => selectFromCatalog(courseId, catalog);

  const saveCatalogEdits = async (updates: { name?: string; code?: string; prerequisiteId?: string | null }) => {
    if (!form.courseId) return;
    const updated = await courseCatalogService.update(form.courseId, updates);
    if (!updated) return;
    const fresh = await refreshCatalog();
    const prereqName = updated.prerequisiteId
      ? fresh.find((c) => c.id === updated.prerequisiteId)?.name ?? NONE_PREREQ
      : NONE_PREREQ;
    onChange({ courseName: updated.name, courseCode: updated.code, prerequisite: prereqName });
  };

  const submitNewCourse = async () => {
    if (!newCourse.name.trim() || !newCourse.code.trim()) return;
    const created = await courseCatalogService.add({
      name: newCourse.name.trim(),
      code: newCourse.code.trim().toUpperCase(),
      prerequisiteId: newCourse.prerequisiteId || null,
    });
    const fresh = await refreshCatalog();
    setAddingCourse(false);
    setNewCourse({ name: '', code: '', prerequisiteId: '' });
    selectFromCatalog(created.id, fresh);
  };

  if (loading) {
    return (
      <Card className="p-6 md:p-8 bg-card/50 backdrop-blur-sm border-border/50">
        <p className="text-muted-foreground">Loading course catalog…</p>
      </Card>
    );
  }

  return (
    <Card className="p-6 md:p-8 bg-card/50 backdrop-blur-sm border-border/50">
      <h2 className="text-2xl font-bold mb-2">Course Information</h2>
      <p className="text-muted-foreground mb-6">
        {canManageCatalog
          ? 'Manage the course catalog and define this course\'s details'
          : 'Select a predefined course and fill in this offering\'s details'}
      </p>

      <div className="space-y-6">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Course Name *</Label>
            {canExpandCatalog && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setAddingCourse((v) => !v)}
              >
                <Plus className="w-4 h-4 mr-1" />
                Add New Course
              </Button>
            )}
          </div>
          <Select value={form.courseId} onValueChange={applyCourseSelection}>
            <SelectTrigger>
              <SelectValue placeholder="Select a course" />
            </SelectTrigger>
            <SelectContent>
              {catalog.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!canManageCatalog && (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Lock className="w-3 h-3" /> Only the three courses in scope are available
            </p>
          )}
        </div>

        {addingCourse && canExpandCatalog && (
          <div className="p-4 rounded-xl border border-dashed border-primary/40 bg-primary/5 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">New Course</p>
              <button type="button" onClick={() => setAddingCourse(false)}>
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
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
              <SelectTrigger>
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
            <Button type="button" size="sm" onClick={submitNewCourse}>
              Save Course
            </Button>
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              Course Code
              {!editingCatalog && <Lock className="w-3 h-3 text-muted-foreground" />}
            </Label>
            {editingCatalog && canManageCatalog ? (
              <Input
                value={form.courseCode}
                onChange={(e) => saveCatalogEdits({ code: e.target.value.toUpperCase() })}
              />
            ) : (
              <Input value={form.courseCode} readOnly disabled className="font-mono bg-muted/40" />
            )}
          </div>

          <div className="space-y-2">
            <Label>Semester *</Label>
            <Select value={form.semester} onValueChange={(v) => onChange({ semester: v })}>
              <SelectTrigger>
                <SelectValue placeholder="Select semester" />
              </SelectTrigger>
              <SelectContent>
                {SEMESTERS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="flex items-center gap-2">
              Prerequisite
              {!editingCatalog && <Lock className="w-3 h-3 text-muted-foreground" />}
            </Label>
            {canManageCatalog && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setEditingCatalog((v) => !v)}>
                <Pencil className="w-3 h-3 mr-1" />
                {editingCatalog ? 'Done editing' : 'Edit course name / code / prerequisite'}
              </Button>
            )}
          </div>
          {editingCatalog && canManageCatalog ? (
            <div className="space-y-3">
              <Input
                value={form.courseName}
                onChange={(e) => saveCatalogEdits({ name: e.target.value })}
                placeholder="Course name"
              />
              <Select
                value={catalog.find((c) => c.name === form.prerequisite)?.id ?? ''}
                onValueChange={(v) => saveCatalogEdits({ prerequisiteId: v === '__none__' ? null : v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Prerequisite" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {catalog
                    .filter((c) => c.id !== form.courseId)
                    .map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <Input value={form.prerequisite || NONE_PREREQ} readOnly disabled className="bg-muted/40" />
          )}
        </div>

        {form.courseId && (
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              Course Coordinator
              <Lock className="w-3 h-3 text-muted-foreground" />
            </Label>
            <Input
              value={catalog.find((c) => c.id === form.courseId)?.coordinatorName ?? 'Unassigned'}
              readOnly
              disabled
              className="bg-muted/40"
            />
            <p className="text-xs text-muted-foreground">
              Supervises this course across all teachers' offerings of it
            </p>
          </div>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="description">Course Description *</Label>
            <span
              className={`text-xs ${
                form.description.trim().length < 20 || form.description.trim().length > 100
                  ? 'text-destructive'
                  : 'text-muted-foreground'
              }`}
            >
              {form.description.trim().length}/100 (min 20)
            </span>
          </div>
          <Textarea
            id="description"
            placeholder="Describe what students will learn in this course (20-100 characters)..."
            rows={4}
            maxLength={100}
            value={form.description}
            onChange={(e) => onChange({ description: e.target.value })}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="maxStudents">Maximum Number of Students (optional)</Label>
          <Input
            id="maxStudents"
            type="number"
            min={1}
            placeholder="e.g., 60"
            value={form.maxStudents ?? ''}
            onChange={(e) =>
              onChange({ maxStudents: e.target.value === '' ? null : Number(e.target.value) })
            }
            className="max-w-xs"
          />
        </div>
      </div>
    </Card>
  );
}
