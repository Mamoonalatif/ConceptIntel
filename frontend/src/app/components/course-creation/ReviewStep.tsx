import { CheckCircle, AlertCircle } from 'lucide-react';
import { Card } from '../ui/card';
import { Badge } from '../ui/badge';
import type { CourseFormData } from '../../types/course';
import { SEMESTERS } from '../../types/course';
import { computeCourseEndDate, computeCourseStatus } from '../../lib/courseUtils';

interface ReviewStepProps {
  form: CourseFormData;
}

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-warning/20 text-warning border-warning/30',
  open: 'bg-success/20 text-success border-success/30',
  closed: 'bg-muted text-muted-foreground border-border',
};

export function ReviewStep({ form }: ReviewStepProps) {
  const semesterLabel = SEMESTERS.find((s) => s.value === form.semester)?.label ?? form.semester;
  const descLen = form.description.trim().length;
  const courseEndDate = computeCourseEndDate(form.courseStartDate, form.courseDurationMonths);
  const status = computeCourseStatus(form.enrollmentStartDate, form.enrollmentEndDate);

  const checks = [
    { ok: !!form.courseId, label: 'Course selected' },
    { ok: !!form.semester, label: 'Semester selected' },
    { ok: descLen >= 20 && descLen <= 100, label: 'Description within 20-100 characters' },
    { ok: !!form.courseStartDate && !!form.courseDurationMonths, label: 'Course schedule set' },
    { ok: !!form.enrollmentStartDate && !!form.enrollmentEndDate, label: 'Enrollment window set' },
  ];

  const allReady = checks.every((c) => c.ok);

  return (
    <div className="space-y-6">
      <Card className="p-6 md:p-8 bg-card/50 backdrop-blur-sm border-border/50">
        <h2 className="text-2xl font-bold mb-2">Review & Publish</h2>
        <p className="text-muted-foreground mb-6">Confirm everything before creating your course</p>

        <div
          className={`p-4 rounded-xl mb-6 flex items-center gap-3 ${
            allReady ? 'bg-success/10 border border-success/20' : 'bg-warning/10 border border-warning/20'
          }`}
        >
          {allReady ? (
            <CheckCircle className="w-5 h-5 text-success shrink-0" />
          ) : (
            <AlertCircle className="w-5 h-5 text-warning shrink-0" />
          )}
          <p className="text-sm">
            {allReady
              ? 'Your course is ready to be created!'
              : 'Complete the missing items below before publishing.'}
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-3 mb-8">
          {checks.map((check) => (
            <div key={check.label} className="flex items-center gap-2 text-sm">
              {check.ok ? (
                <CheckCircle className="w-4 h-4 text-success shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-warning shrink-0" />
              )}
              <span className={check.ok ? '' : 'text-muted-foreground'}>{check.label}</span>
            </div>
          ))}
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div>
              <h3 className="font-semibold text-lg">{form.courseName || 'No course selected'}</h3>
              <p className="text-sm text-muted-foreground font-mono">{form.courseCode}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{semesterLabel || 'No semester'}</Badge>
              <Badge className={STATUS_STYLES[status]}>
                {status.charAt(0).toUpperCase() + status.slice(1)}
              </Badge>
              <Badge variant="outline">Prerequisite: {form.prerequisite}</Badge>
            </div>
            {form.description && (
              <p className="text-sm text-muted-foreground line-clamp-3">{form.description}</p>
            )}
          </div>

          <div className="space-y-4 text-sm">
            <div>
              <p className="text-muted-foreground">Course Duration</p>
              <p>
                {form.courseStartDate || '—'} → {courseEndDate || '—'} ({form.courseDurationMonths}{' '}
                month{form.courseDurationMonths > 1 ? 's' : ''})
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Enrollment Window</p>
              <p>
                {form.enrollmentStartDate || '—'} → {form.enrollmentEndDate || '—'}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Maximum Students</p>
              <p>{form.maxStudents ?? 'Unlimited'}</p>
            </div>
            {form.enrollmentCode && (
              <div>
                <p className="text-muted-foreground">Enrollment Code</p>
                <p className="font-mono font-semibold">{form.enrollmentCode}</p>
              </div>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
