import { Calendar, UserCheck, Info } from 'lucide-react';
import { Card } from '../ui/card';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import type { CourseFormData } from '../../types/course';
import { computeCourseEndDate, computeCourseStatus, todayISO } from '../../lib/courseUtils';

interface DatesStatusStepProps {
  form: CourseFormData;
  onChange: (updates: Partial<CourseFormData>) => void;
}

const DURATION_OPTIONS = [1, 2, 3, 4, 5, 6, 12];

const STATUS_COPY: Record<string, { label: string; desc: string; className: string }> = {
  draft: {
    label: 'Draft',
    desc: 'Enrollment has not opened yet — only you can see this course',
    className: 'bg-warning/20 text-warning border-warning/30',
  },
  open: {
    label: 'Open',
    desc: 'Within the enrollment window — students can join now',
    className: 'bg-success/20 text-success border-success/30',
  },
  closed: {
    label: 'Closed',
    desc: 'The enrollment window has ended — no new enrollments',
    className: 'bg-muted text-muted-foreground border-border',
  },
};

export function DatesStatusStep({ form, onChange }: DatesStatusStepProps) {
  const courseEndDate = computeCourseEndDate(form.courseStartDate, form.courseDurationMonths);
  const status = computeCourseStatus(form.enrollmentStartDate, form.enrollmentEndDate);
  const statusInfo = STATUS_COPY[status];

  return (
    <div className="space-y-6">
      <Card className="p-6 md:p-8 bg-card/50 backdrop-blur-sm border-border/50">
        <div className="flex items-center gap-3 mb-2">
          <Calendar className="w-6 h-6 text-primary" />
          <h2 className="text-2xl font-bold">Course Schedule</h2>
        </div>
        <p className="text-muted-foreground mb-6">
          The course end date is calculated from the start date and duration
        </p>

        <div className="grid md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label htmlFor="courseStartDate">Course Start Date *</Label>
            <Input
              id="courseStartDate"
              type="date"
              min={todayISO()}
              value={form.courseStartDate}
              onChange={(e) => onChange({ courseStartDate: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">Cannot be a past date</p>
          </div>
          <div className="space-y-2">
            <Label>Course Duration *</Label>
            <Select
              value={String(form.courseDurationMonths)}
              onValueChange={(v) => onChange({ courseDurationMonths: Number(v) })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DURATION_OPTIONS.map((m) => (
                  <SelectItem key={m} value={String(m)}>
                    {m} month{m > 1 ? 's' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="mt-6 space-y-2">
          <Label className="text-muted-foreground">Course End Date (calculated)</Label>
          <Input value={courseEndDate || '—'} readOnly disabled className="bg-muted/40 max-w-xs" />
        </div>
      </Card>

      <Card className="p-6 md:p-8 bg-card/50 backdrop-blur-sm border-border/50">
        <div className="flex items-center gap-3 mb-2">
          <UserCheck className="w-6 h-6 text-secondary" />
          <h2 className="text-2xl font-bold">Enrollment Window</h2>
        </div>
        <p className="text-muted-foreground mb-6">
          Control when students can enroll in this course
        </p>

        <div className="grid md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label htmlFor="enrollmentStartDate">Enrollment Start Date *</Label>
            <Input
              id="enrollmentStartDate"
              type="date"
              value={form.enrollmentStartDate}
              onChange={(e) => onChange({ enrollmentStartDate: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">Must be before the enrollment end date</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="enrollmentEndDate">Enrollment End Date *</Label>
            <Input
              id="enrollmentEndDate"
              type="date"
              max={courseEndDate || undefined}
              value={form.enrollmentEndDate}
              onChange={(e) => onChange({ enrollmentEndDate: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              Can be set any time up to the course end date, so late students can still join
            </p>
          </div>
        </div>
      </Card>

      <Card className="p-6 md:p-8 bg-card/50 backdrop-blur-sm border-border/50">
        <h2 className="text-2xl font-bold mb-2">Course Status</h2>
        <p className="text-muted-foreground mb-6">
          Status is determined automatically from the enrollment window — it isn't set manually
        </p>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl bg-muted/20 border border-border">
          <div className="flex items-start gap-2">
            <Info className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
            <p className="text-sm text-muted-foreground">{statusInfo.desc}</p>
          </div>
          <Badge className={statusInfo.className}>{statusInfo.label}</Badge>
        </div>

        <div className="grid sm:grid-cols-3 gap-4 text-sm mt-4">
          {(['draft', 'open', 'closed'] as const).map((s) => (
            <div
              key={s}
              className={`p-4 rounded-xl border ${
                status === s ? 'border-primary bg-primary/10' : 'border-border bg-muted/20'
              }`}
            >
              <p className="font-semibold">{STATUS_COPY[s].label}</p>
              <p className="text-muted-foreground text-xs mt-1">{STATUS_COPY[s].desc}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
