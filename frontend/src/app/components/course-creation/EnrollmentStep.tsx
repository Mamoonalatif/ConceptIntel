import { Copy, Link as LinkIcon, RefreshCw, Check } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Card } from '../ui/card';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import type { CourseFormData, CourseVisibility } from '../../types/course';
import { generateEnrollmentCode, generateInviteLink } from '../../lib/courseUtils';

interface EnrollmentStepProps {
  form: CourseFormData;
  onChange: (updates: Partial<CourseFormData>) => void;
}

export function EnrollmentStep({ form, onChange }: EnrollmentStepProps) {
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);

  const regenerateCode = () => {
    const code = generateEnrollmentCode(form.subject, form.semester);
    onChange({ enrollmentCode: code, inviteLink: generateInviteLink(code) });
    toast.success('New enrollment code generated');
  };

  const copyToClipboard = async (text: string, type: 'code' | 'link') => {
    await navigator.clipboard.writeText(text);
    setCopied(type);
    toast.success(type === 'code' ? 'Enrollment code copied' : 'Invite link copied');
    setTimeout(() => setCopied(null), 2000);
  };

  const ensureCodes = () => {
    if (!form.enrollmentCode && form.subject && form.semester) {
      const code = generateEnrollmentCode(form.subject, form.semester);
      onChange({ enrollmentCode: code, inviteLink: generateInviteLink(code) });
    }
  };

  return (
    <Card className="p-6 md:p-8 bg-gradient-to-br from-primary/5 via-transparent to-secondary/5 border-primary/20">
      <h2 className="text-2xl font-bold mb-2">Enrollment & Access</h2>
      <p className="text-muted-foreground mb-6">Control visibility and how students join your course</p>

      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl bg-card/80 border border-border">
          <div>
            <Label>Course Visibility</Label>
            <p className="text-sm text-muted-foreground mt-1">Draft courses are only visible to you</p>
          </div>
          <Select
            value={form.visibility}
            onValueChange={(v) => onChange({ visibility: v as CourseVisibility })}
          >
            <SelectTrigger className="w-full sm:w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-4 p-6 rounded-xl bg-card/80 border border-border">
          <div className="flex items-center justify-between">
            <Label>Enrollment Code</Label>
            <Button type="button" variant="ghost" size="sm" onClick={regenerateCode}>
              <RefreshCw className="w-4 h-4 mr-1" />
              Regenerate
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Input
              value={form.enrollmentCode}
              readOnly
              className="font-mono"
              placeholder="Generate by selecting subject & semester"
              onFocus={ensureCodes}
            />
            <Button
              type="button"
              size="icon"
              variant="outline"
              onClick={() => form.enrollmentCode && copyToClipboard(form.enrollmentCode, 'code')}
              disabled={!form.enrollmentCode}
            >
              {copied === 'code' ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
            </Button>
          </div>

          <div>
            <Label className="text-sm text-muted-foreground">Invitation Link</Label>
            <div className="flex items-center gap-2 mt-2">
              <Input value={form.inviteLink} readOnly className="font-mono text-sm" onFocus={ensureCodes} />
              <Button
                type="button"
                size="icon"
                variant="outline"
                onClick={() => form.inviteLink && copyToClipboard(form.inviteLink, 'link')}
                disabled={!form.inviteLink}
              >
                {copied === 'link' ? <Check className="w-4 h-4 text-success" /> : <LinkIcon className="w-4 h-4" />}
              </Button>
            </div>
          </div>
        </div>

        <div className="grid sm:grid-cols-3 gap-4 text-sm">
          {[
            { status: 'draft', label: 'Draft', desc: 'Only you can see this course' },
            { status: 'open', label: 'Open', desc: 'Students can enroll with code/link' },
            { status: 'closed', label: 'Closed', desc: 'No new enrollments allowed' },
          ].map((item) => (
            <div
              key={item.status}
              className={`p-4 rounded-xl border ${
                form.visibility === item.status
                  ? 'border-primary bg-primary/10'
                  : 'border-border bg-muted/20'
              }`}
            >
              <p className="font-semibold">{item.label}</p>
              <p className="text-muted-foreground text-xs mt-1">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}
