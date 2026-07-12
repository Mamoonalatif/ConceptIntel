import { useState, useCallback, useEffect } from 'react';
import { motion } from 'motion/react';
import { useNavigate, useSearchParams, useLocation } from 'react-router';
import { toast } from 'sonner';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Button } from '../components/ui/button';
import { CreationStepper, STEPS } from '../components/course-creation/CreationStepper';
import { CourseDetailsStep } from '../components/course-creation/CourseDetailsStep';
import { DatesStatusStep } from '../components/course-creation/DatesStatusStep';
import { ReviewStep } from '../components/course-creation/ReviewStep';
import { emptyCourseForm, type CourseFormData, type UserCourseRole } from '../types/course';
import { validateStep } from '../lib/courseUtils';
import { courseService } from '../services/courseService';
import { MOCK_USER_IDS } from '../config/mockUsers';

function roleFromPath(pathname: string): UserCourseRole {
  if (pathname.startsWith('/admin')) return 'admin';
  if (pathname.startsWith('/hod')) return 'hod';
  if (pathname.startsWith('/coordinator')) return 'coordinator';
  return 'teacher';
}

export function CourseCreationPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const editId = searchParams.get('edit');
  const role = roleFromPath(location.pathname);

  const [step, setStep] = useState(0);
  const [form, setForm] = useState<CourseFormData>(emptyCourseForm());
  const [loading, setLoading] = useState(!!editId);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editId) return;
    courseService.getById(editId).then((existing) => {
      if (existing) {
        const { id, createdAt, updatedAt, teacherId, teacherName, ...rest } = existing;
        setForm(rest);
      }
      setLoading(false);
    });
  }, [editId]);

  const updateForm = useCallback((updates: Partial<CourseFormData>) => {
    setForm((prev) => ({ ...prev, ...updates }));
  }, []);

  const goNext = () => {
    const error = validateStep(step, form);
    if (error) {
      toast.error(error);
      return;
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const goBack = () => setStep((s) => Math.max(s - 1, 0));

  const homePath = `/${role}/dashboard`;
  const coursesPath = `/${role}/courses`;

  const handleSave = async () => {
    setSaving(true);
    try {
      const saved = await courseService.save(form, MOCK_USER_IDS[role], editId ?? undefined);
      toast.success(editId ? 'Course updated successfully' : 'Course created successfully!');
      navigate(`${coursesPath}/${saved.id}`);
    } catch {
      toast.error('Failed to save course');
    } finally {
      setSaving(false);
    }
  };

  const renderStep = () => {
    switch (step) {
      case 0:
        return <CourseDetailsStep form={form} onChange={updateForm} role={role} />;
      case 1:
        return <DatesStatusStep form={form} onChange={updateForm} />;
      case 2:
        return <ReviewStep form={form} />;
      default:
        return null;
    }
  };

  if (loading) {
    return (
      <div className="min-h-full flex items-center justify-center py-24">
        <p className="text-muted-foreground">Loading course…</p>
      </div>
    );
  }

  return (
    <div className="min-h-full">
      <div className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-4 md:px-6 py-4">
          <div className="mb-4">
            <h1 className="text-xl md:text-2xl font-bold">
              {editId ? 'Edit Course' : 'Create New Course'}
            </h1>
            <p className="text-sm text-muted-foreground">
              {role === 'teacher'
                ? 'Set up a scheduled offering of one of the three courses in scope'
                : 'Manage the course catalog and its offerings'}
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
          <Button variant="outline" onClick={() => navigate(homePath)}>
            Cancel
          </Button>

          <div className="flex flex-wrap gap-3 w-full sm:w-auto justify-end">
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
                onClick={handleSave}
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
