import { CheckCircle, AlertCircle } from 'lucide-react';
import { Card } from '../ui/card';
import { Badge } from '../ui/badge';
import type { CourseFormData } from '../../types/course';
import { SUBJECTS, SEMESTERS } from '../../types/course';

interface ReviewStepProps {
  form: CourseFormData;
}

export function ReviewStep({ form }: ReviewStepProps) {
  const subjectLabel = SUBJECTS.find((s) => s.value === form.subject)?.label ?? form.subject;
  const semesterLabel = SEMESTERS.find((s) => s.value === form.semester)?.label ?? form.semester;

  const checks = [
    { ok: !!form.title, label: 'Course title set' },
    { ok: !!form.subject && !!form.semester, label: 'Subject & semester selected' },
    { ok: form.clos.length > 0, label: `${form.clos.length} CLO(s) defined` },
    { ok: !!form.schedule.startDate && !!form.schedule.endDate, label: 'Schedule configured' },
    { ok: !!form.enrollmentCode, label: 'Enrollment code ready' },
    { ok: form.modules.length > 0, label: `${form.modules.length} module(s) in roadmap` },
  ];

  const allReady = checks.every((c) => c.ok);

  return (
    <div className="space-y-6">
      <Card className="p-6 md:p-8 bg-card/50 backdrop-blur-sm border-border/50">
        <h2 className="text-2xl font-bold mb-2">Review & Publish</h2>
        <p className="text-muted-foreground mb-6">Confirm everything before creating your course</p>

        <div className={`p-4 rounded-xl mb-6 flex items-center gap-3 ${allReady ? 'bg-success/10 border border-success/20' : 'bg-warning/10 border border-warning/20'}`}>
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
            <h3 className="font-semibold text-lg">{form.title || 'Untitled Course'}</h3>
            <div className="flex flex-wrap gap-2">
              <Badge>{subjectLabel}</Badge>
              <Badge variant="outline">{semesterLabel}</Badge>
              <Badge
                variant={form.visibility === 'open' ? 'default' : 'secondary'}
                className={form.visibility === 'open' ? 'bg-success/20 text-success border-success/30' : ''}
              >
                {form.visibility.charAt(0).toUpperCase() + form.visibility.slice(1)}
              </Badge>
              {form.aiAssisted && (
                <Badge className="bg-primary/20 text-primary">AI Generated</Badge>
              )}
            </div>
            {form.description && (
              <p className="text-sm text-muted-foreground line-clamp-3">{form.description}</p>
            )}
            {form.thumbnail && (
              <img src={form.thumbnail} alt="" className="w-full h-32 object-cover rounded-xl" />
            )}
          </div>

          <div className="space-y-4 text-sm">
            <div>
              <p className="text-muted-foreground">Enrollment Code</p>
              <p className="font-mono font-semibold">{form.enrollmentCode || '—'}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Schedule</p>
              <p>
                {form.schedule.startDate || '—'} → {form.schedule.endDate || '—'}
              </p>
              <p className="text-muted-foreground">
                {form.schedule.sessionsPerWeek}x/week · {form.schedule.sessionDuration} min ·{' '}
                {form.schedule.preferredDays.join(', ') || '—'}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Prerequisites</p>
              <p>{form.prerequisites.length ? form.prerequisites.join(', ') : 'None'}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Modules</p>
              <p>{form.modules.length} modules planned</p>
            </div>
          </div>
        </div>
      </Card>

      {form.modules.length > 0 && (
        <Card className="p-6 bg-card/50 border-border/50">
          <h3 className="font-semibold mb-4">Roadmap Summary</h3>
          <div className="space-y-2">
            {form.modules.map((m, i) => (
              <div key={m.id} className="flex items-center gap-3 text-sm p-2 rounded-lg hover:bg-muted/30">
                <span className="w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                  {i + 1}
                </span>
                <span className="font-medium flex-1">{m.title}</span>
                <span className="text-muted-foreground">{m.topics.length} topics</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
