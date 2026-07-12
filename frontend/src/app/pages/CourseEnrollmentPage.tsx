import { motion } from 'motion/react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Brain, ArrowLeft, Plus, BookOpen, Users, Star } from 'lucide-react';
import { useState } from 'react';
import { enrollmentService } from '../services/courseService';
import { MOCK_USER_IDS } from '../config/mockUsers';

const recommendedCourses = [
  { id: 1, name: 'Data Structures & Algorithms', instructor: 'Dr. Smith', students: 245, rating: 4.8 },
  { id: 2, name: 'Machine Learning Fundamentals', instructor: 'Prof. Johnson', students: 198, rating: 4.9 },
  { id: 3, name: 'Web Development Advanced', instructor: 'Dr. Williams', students: 312, rating: 4.7 },
];

const ENROLL_ERROR_MESSAGES: Record<string, string> = {
  not_found: 'No course matches that enrollment code',
  not_open: 'This course is not currently open for enrollment',
  already_enrolled: "You're already enrolled in this course",
  full: 'This course has reached its maximum number of students',
};

export function CourseEnrollmentPage() {
  const navigate = useNavigate();
  const [enrollmentCode, setEnrollmentCode] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleEnroll = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!enrollmentCode.trim()) return;
    setSubmitting(true);
    try {
      const result = await enrollmentService.enrollByCode(enrollmentCode, MOCK_USER_IDS.student);
      if (result.ok) {
        toast.success(`Enrolled in ${result.course.courseName}!`);
        navigate('/student/dashboard');
      } else {
        toast.error(ENROLL_ERROR_MESSAGES[result.reason]);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-6 py-12">
        <Button variant="ghost" size="sm" className="mb-8" asChild>
          <Link to="/student/dashboard">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Dashboard
          </Link>
        </Button>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-8"
        >
          <div className="text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center">
              <Plus className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-4xl font-bold mb-2">Join a Course</h1>
            <p className="text-xl text-muted-foreground">
              Enter an enrollment code or browse recommended courses
            </p>
          </div>

          {/* Enrollment Code Form */}
          <Card className="p-8 bg-card/50 backdrop-blur-sm border-border/50">
            <h2 className="text-2xl font-bold mb-6">Enter Enrollment Code</h2>
            <form onSubmit={handleEnroll} className="space-y-4">
              <Input
                placeholder="ABC-2026-CS101"
                value={enrollmentCode}
                onChange={(e) => setEnrollmentCode(e.target.value)}
                className="text-lg text-center tracking-wider font-mono"
              />
              <Button type="submit" className="w-full" size="lg" disabled={submitting}>
                {submitting ? 'Joining...' : 'Join Course'}
              </Button>
            </form>
          </Card>

          {/* Recommended Courses */}
          <div>
            <h2 className="text-2xl font-bold mb-6">Recommended Courses</h2>
            <div className="grid md:grid-cols-2 gap-6">
              {recommendedCourses.map((course) => (
                <motion.div
                  key={course.id}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  whileHover={{ scale: 1.02 }}
                  transition={{ duration: 0.2 }}
                >
                  <Card className="p-6 h-full hover:shadow-xl transition-shadow cursor-pointer bg-card/50 backdrop-blur-sm border-border/50">
                    <div className="flex items-start justify-between mb-4">
                      <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                        <BookOpen className="w-6 h-6 text-primary" />
                      </div>
                      <div className="flex items-center gap-1 text-sm">
                        <Star className="w-4 h-4 fill-yellow-500 text-yellow-500" />
                        <span className="font-medium">{course.rating}</span>
                      </div>
                    </div>
                    
                    <h3 className="text-xl font-bold mb-2">{course.name}</h3>
                    <p className="text-sm text-muted-foreground mb-4">{course.instructor}</p>
                    
                    <div className="flex items-center gap-4 text-sm text-muted-foreground mb-4">
                      <div className="flex items-center gap-1">
                        <Users className="w-4 h-4" />
                        <span>{course.students} students</span>
                      </div>
                    </div>

                    <Button className="w-full">Enroll Now</Button>
                  </Card>
                </motion.div>
              ))}
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
