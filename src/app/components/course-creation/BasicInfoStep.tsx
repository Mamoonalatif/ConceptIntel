import { useState } from 'react';
import { Plus, X, Upload } from 'lucide-react';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Card } from '../ui/card';
import type { CourseFormData } from '../../types/course';
import { SUBJECTS, SEMESTERS } from '../../types/course';

interface BasicInfoStepProps {
  form: CourseFormData;
  onChange: (updates: Partial<CourseFormData>) => void;
  onThumbnailChange: (file: File) => void;
}

export function BasicInfoStep({ form, onChange, onThumbnailChange }: BasicInfoStepProps) {
  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onThumbnailChange(file);
  };

  return (
    <Card className="p-6 md:p-8 bg-card/50 backdrop-blur-sm border-border/50">
      <h2 className="text-2xl font-bold mb-2">Course Information</h2>
      <p className="text-muted-foreground mb-6">Define the core details of your course</p>

      <div className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="title">Course Title *</Label>
          <Input
            id="title"
            placeholder="e.g., Data Structures and Algorithms"
            value={form.title}
            onChange={(e) => onChange({ title: e.target.value })}
            className="text-lg"
          />
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label>Subject *</Label>
            <Select value={form.subject} onValueChange={(v) => onChange({ subject: v })}>
              <SelectTrigger>
                <SelectValue placeholder="Select subject" />
              </SelectTrigger>
              <SelectContent>
                {SUBJECTS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
          <Label htmlFor="description">Course Description</Label>
          <Textarea
            id="description"
            placeholder="Describe what students will learn, teaching approach, and expected outcomes..."
            rows={4}
            value={form.description}
            onChange={(e) => onChange({ description: e.target.value })}
          />
        </div>

        <div className="space-y-2">
          <Label>Course Thumbnail</Label>
          <label className="block border-2 border-dashed border-border rounded-xl p-8 text-center hover:border-primary/50 transition-colors cursor-pointer">
            <input type="file" accept="image/*" className="hidden" onChange={handleFile} />
            {form.thumbnail ? (
              <div className="space-y-3">
                <img
                  src={form.thumbnail}
                  alt="Course thumbnail preview"
                  className="mx-auto h-32 w-auto rounded-lg object-cover"
                />
                <p className="text-sm text-muted-foreground">Click to change image</p>
              </div>
            ) : (
              <>
                <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Click to upload or drag and drop</p>
                <p className="text-xs text-muted-foreground mt-1">PNG, JPG up to 5MB</p>
              </>
            )}
          </label>
        </div>
      </div>
    </Card>
  );
}

interface ListFieldProps {
  label: string;
  placeholder: string;
  items: string[];
  onAdd: (item: string) => void;
  onRemove: (index: number) => void;
}

function ListField({ label, placeholder, items, onAdd, onRemove }: ListFieldProps) {
  const [value, setValue] = useState('');

  return (
    <div className="space-y-3">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input
          placeholder={placeholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && value.trim()) {
              e.preventDefault();
              onAdd(value.trim());
              setValue('');
            }
          }}
        />
        <Button
          type="button"
          onClick={() => {
            if (value.trim()) {
              onAdd(value.trim());
              setValue('');
            }
          }}
        >
          <Plus className="w-4 h-4" />
        </Button>
      </div>
      {items.length > 0 && (
        <div className="space-y-2">
          {items.map((item, i) => (
            <div
              key={i}
              className="flex items-start gap-2 p-3 rounded-lg bg-primary/5 border border-primary/10"
            >
              <span className="text-sm flex-1">{item}</span>
              <button type="button" onClick={() => onRemove(i)} className="shrink-0">
                <X className="w-4 h-4 text-muted-foreground hover:text-foreground" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface OutcomesStepProps {
  form: CourseFormData;
  onChange: (updates: Partial<CourseFormData>) => void;
}

export function OutcomesStep({ form, onChange }: OutcomesStepProps) {
  return (
    <div className="space-y-6">
      <Card className="p-6 md:p-8 bg-card/50 backdrop-blur-sm border-border/50">
        <h2 className="text-2xl font-bold mb-2">Prerequisites</h2>
        <p className="text-muted-foreground mb-6">Courses or skills students should have before enrolling</p>
        <ListField
          label="Prerequisite Courses"
          placeholder="e.g., Introduction to Programming"
          items={form.prerequisites}
          onAdd={(item) => onChange({ prerequisites: [...form.prerequisites, item] })}
          onRemove={(i) => onChange({ prerequisites: form.prerequisites.filter((_, idx) => idx !== i) })}
        />
      </Card>

      <Card className="p-6 md:p-8 bg-card/50 backdrop-blur-sm border-border/50">
        <h2 className="text-2xl font-bold mb-2">Learning Outcomes</h2>
        <p className="text-muted-foreground mb-6">Align course and program-level outcomes for curriculum intelligence</p>
        <div className="space-y-6">
          <ListField
            label="Course Learning Outcomes (CLOs) *"
            placeholder="e.g., Analyze algorithm complexity using Big-O notation"
            items={form.clos}
            onAdd={(item) => onChange({ clos: [...form.clos, item] })}
            onRemove={(i) => onChange({ clos: form.clos.filter((_, idx) => idx !== i) })}
          />
          <ListField
            label="Program Learning Outcomes (PLOs)"
            placeholder="e.g., PLO-3: Apply computational thinking to solve problems"
            items={form.plos}
            onAdd={(item) => onChange({ plos: [...form.plos, item] })}
            onRemove={(i) => onChange({ plos: form.plos.filter((_, idx) => idx !== i) })}
          />
        </div>
      </Card>
    </div>
  );
}
