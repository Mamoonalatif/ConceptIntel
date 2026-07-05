import { useState, useCallback } from 'react';
import { motion } from 'motion/react';
import { useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { ArrowLeft, ArrowRight, Save } from 'lucide-react';
import { Button } from '../components/ui/button';
import { CreationStepper, STEPS } from '../components/course-creation/CreationStepper';
import { BasicInfoStep, OutcomesStep } from '../components/course-creation/BasicInfoStep';
import { ScheduleStep } from '../components/course-creation/ScheduleStep';
import { EnrollmentStep } from '../components/course-creation/EnrollmentStep';
import { AiRoadmapStep } from '../components/course-creation/AiRoadmapStep';
import { ReviewStep } from '../components/course-creation/ReviewStep';
import { emptyCourseForm, type CourseFormData } from '../types/course';
import { validateStep, generateEnrollmentCode, generateInviteLink } from '../lib/courseUtils';
import { courseService } from '../services/courseService';

export function CourseCreationPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const editId = searchParams.get('edit');

  const [step, setStep] = useState(0);
  const [form, setForm] = useState<CourseFormData>(() => {
    if (editId) {
      const existing = courseService.getById(editId);
      if (existing) {
        const { id, createdAt, updatedAt, teacherId, teacherName, ...rest } = existing;
        return rest;
      }
    }
    return emptyCourseForm();
  });
  const [saving, setSaving] = useState(false);

  const updateForm = useCallback((updates: Partial<CourseFormData>) => {
    setForm((prev) => ({ ...prev, ...updates }));
  }, []);

  const handleThumbnailChange = (file: File) => {
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image must be under 5MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => updateForm({ thumbnail: e.target?.result as string });
    reader.readAsDataURL(file);
  };

  const goNext = () => {
    const error = validateStep(step, form);
    if (error) {
      toast.error(error);
      return;
    }
    if (step === 2 && !form.enrollmentCode && form.subject && form.semester) {
      const code = generateEnrollmentCode(form.subject, form.semester);
      updateForm({ enrollmentCode: code, inviteLink: generateInviteLink(code) });
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const goBack = () => setStep((s) => Math.max(s - 1, 0));

  const handleSave = (visibility?: CourseFormData['visibility']) => {
    setSaving(true);
    try {
      const data = visibility ? { ...form, visibility } : form;
      const saved = courseService.save(data, editId ?? undefined);
      toast.success(
        visibility === 'draft'
          ? 'Course saved as draft'
          : editId
            ? 'Course updated successfully'
            : 'Course created successfully!'
      );
      navigate(`/teacher/courses/${saved.id}`);
    } catch {
      toast.error('Failed to save course');
    } finally {
      setSaving(false);
    }
  };

  const renderStep = () => {
    switch (step) {
      case 0:
        return (
          <BasicInfoStep form={form} onChange={updateForm} onThumbnailChange={handleThumbnailChange} />
        );
      case 1:
        return <OutcomesStep form={form} onChange={updateForm} />;
      case 2:
        return <ScheduleStep form={form} onChange={updateForm} />;
      case 3:
        return <EnrollmentStep form={form} onChange={updateForm} />;
      case 4:
        return <AiRoadmapStep form={form} onChange={updateForm} />;
      case 5:
        return <ReviewStep form={form} />;
      default:
        return null;
    }
  };

  return (
    <div className="min-h-full">
      <div className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-4 md:px-6 py-4">
          <div className="mb-4">
            <h1 className="text-xl md:text-2xl font-bold">
              {editId ? 'Edit Course' : 'Create New Course'}
            </h1>
            <p className="text-sm text-muted-foreground">
              Design your AI-powered course with ConceptIntel
            </p>
          </div>
          <CreationStepper
            currentStep={step}
            onStepClick={(s) => s <= step && setStep(s)}
          />
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 md:px-6 py-6 md:py-8">
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.2 }}
        >
          {renderStep()}
        </motion.div>

        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mt-8 pt-6 border-t border-border">
          <Button variant="outline" onClick={() => navigate('/teacher/dashboard')}>
            Cancel
          </Button>

          <div className="flex flex-wrap gap-3 w-full sm:w-auto justify-end">
            <Button
              variant="outline"
              onClick={() => handleSave('draft')}
              disabled={saving || !form.title}
            >
              <Save className="w-4 h-4 mr-2" />
              Save Draft
            </Button>

            {step > 0 && (
              <Button variant="outline" onClick={goBack}>
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
            )}

            {step < STEPS.length - 1 ? (
              <Button onClick={goNext}>
                Continue
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            ) : (
              <Button
                onClick={() => handleSave(form.visibility === 'draft' ? 'open' : form.visibility)}
                disabled={saving}
                className="bg-gradient-to-r from-primary to-secondary"
              >
                {saving ? 'Creating...' : editId ? 'Update Course' : 'Create Course'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
