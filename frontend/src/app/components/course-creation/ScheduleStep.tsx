import { Calendar, Clock } from 'lucide-react';
import { Card } from '../ui/card';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { cn } from '../ui/utils';
import type { CourseFormData } from '../../types/course';
import { WEEK_DAYS } from '../../types/course';

interface ScheduleStepProps {
  form: CourseFormData;
  onChange: (updates: Partial<CourseFormData>) => void;
}

export function ScheduleStep({ form, onChange }: ScheduleStepProps) {
  const updateSchedule = (updates: Partial<CourseFormData['schedule']>) => {
    onChange({ schedule: { ...form.schedule, ...updates } });
  };

  const toggleDay = (day: string) => {
    const days = form.schedule.preferredDays;
    updateSchedule({
      preferredDays: days.includes(day) ? days.filter((d) => d !== day) : [...days, day],
    });
  };

  return (
    <Card className="p-6 md:p-8 bg-card/50 backdrop-blur-sm border-border/50">
      <div className="flex items-center gap-3 mb-2">
        <Calendar className="w-6 h-6 text-primary" />
        <h2 className="text-2xl font-bold">Schedule Setup</h2>
      </div>
      <p className="text-muted-foreground mb-6">Configure the academic calendar and session timing</p>

      <div className="space-y-6">
        <div className="grid md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label htmlFor="startDate">Start Date *</Label>
            <Input
              id="startDate"
              type="date"
              value={form.schedule.startDate}
              onChange={(e) => updateSchedule({ startDate: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="endDate">End Date *</Label>
            <Input
              id="endDate"
              type="date"
              value={form.schedule.endDate}
              onChange={(e) => updateSchedule({ endDate: e.target.value })}
            />
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label>Sessions Per Week</Label>
            <Select
              value={String(form.schedule.sessionsPerWeek)}
              onValueChange={(v) => updateSchedule({ sessionsPerWeek: Number(v) })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4, 5].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n} session{n > 1 ? 's' : ''} / week
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Clock className="w-4 h-4" />
              Session Duration (minutes)
            </Label>
            <Select
              value={String(form.schedule.sessionDuration)}
              onValueChange={(v) => updateSchedule({ sessionDuration: Number(v) })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[60, 75, 90, 120].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n} minutes
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-3">
          <Label>Preferred Session Days *</Label>
          <div className="flex flex-wrap gap-2">
            {WEEK_DAYS.map((day) => {
              const selected = form.schedule.preferredDays.includes(day);
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggleDay(day)}
                  className={cn(
                    'px-4 py-2 rounded-xl text-sm font-medium border transition-all',
                    selected
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-muted/30 border-border text-muted-foreground hover:border-primary/50'
                  )}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </Card>
  );
}
