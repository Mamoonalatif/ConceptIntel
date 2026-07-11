import { useMemo } from 'react';
import { Link, useParams } from 'react-router';
import { motion } from 'motion/react';
import {
  BookOpen,
  Plus,
  Calendar,
  Edit,
  Trash2,
  Upload,
  Network,
  Copy,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { courseService } from '../services/courseService';
import { SUBJECTS, SEMESTERS, type Course } from '../types/course';

function CourseCard({ course }: { course: Course }) {
  const subjectLabel = SUBJECTS.find((s) => s.value === course.subject)?.label ?? course.subject;
  const semesterLabel = SEMESTERS.find((s) => s.value === course.semester)?.label ?? course.semester;

  const handleDelete = () => {
    if (confirm(`Delete "${course.title}"? This cannot be undone.`)) {
      courseService.delete(course.id);
      toast.success('Course deleted');
      window.location.reload();
    }
  };

  const copyCode = () => {
    navigator.clipboard.writeText(course.enrollmentCode);
    toast.success('Enrollment code copied');
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      <Card className="overflow-hidden bg-card/50 backdrop-blur-sm hover:shadow-lg transition-shadow">
        <div className="flex flex-col md:flex-row">
          {course.thumbnail ? (
            <img
              src={course.thumbnail}
              alt=""
              className="md:w-48 h-32 md:h-auto object-cover shrink-0"
            />
          ) : (
            <div className="md:w-48 h-32 md:h-auto bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center shrink-0">
              <BookOpen className="w-10 h-10 text-primary/50" />
            </div>
          )}

          <div className="flex-1 p-5">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-3">
              <div>
                <Link to={`/teacher/courses/${course.id}`}>
                  <h3 className="text-lg font-bold hover:text-primary transition-colors">{course.title}</h3>
                </Link>
                <div className="flex flex-wrap gap-2 mt-2">
                  <Badge variant="outline">{subjectLabel}</Badge>
                  <Badge variant="outline">{semesterLabel}</Badge>
                  <Badge
                    className={
                      course.visibility === 'open'
                        ? 'bg-success/20 text-success border-success/30'
                        : course.visibility === 'draft'
                          ? 'bg-warning/20 text-warning border-warning/30'
                          : ''
                    }
                  >
                    {course.visibility}
                  </Badge>
                  {course.aiAssisted && (
                    <Badge className="bg-primary/20 text-primary">AI</Badge>
                  )}
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button size="sm" variant="outline" asChild>
                  <Link to={`/teacher/course/create?edit=${course.id}`}>
                    <Edit className="w-4 h-4" />
                  </Link>
                </Button>
                <Button size="sm" variant="outline" onClick={handleDelete}>
                  <Trash2 className="w-4 h-4 text-destructive" />
                </Button>
              </div>
            </div>

            {course.description && (
              <p className="text-sm text-muted-foreground line-clamp-2 mb-3">{course.description}</p>
            )}

            <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground mb-4">
              <span className="flex items-center gap-1">
                <Calendar className="w-4 h-4" />
                {course.schedule.startDate} — {course.schedule.endDate}
              </span>
              <span>{course.modules.length} modules</span>
              <span>{course.clos.length} CLOs</span>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={copyCode}>
                <Copy className="w-3 h-3 mr-1" />
                {course.enrollmentCode}
              </Button>
              <Button size="sm" variant="outline" asChild>
                <Link to={`/teacher/course/${course.id}/content`}>
                  <Upload className="w-3 h-3 mr-1" />
                  Upload Content
                </Link>
              </Button>
              <Button size="sm" variant="outline" asChild>
                <Link to={`/teacher/course/${course.id}/knowledge-graph`}>
                  <Network className="w-3 h-3 mr-1" />
                  Knowledge Graph
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </Card>
    </motion.div>
  );
}

function CourseDetailView({ course }: { course: Course }) {
  const subjectLabel = SUBJECTS.find((s) => s.value === course.subject)?.label ?? course.subject;

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">{course.title}</h1>
          <p className="text-muted-foreground mt-1">
            {subjectLabel} · Created {new Date(course.createdAt).toLocaleDateString()}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link to={`/teacher/course/create?edit=${course.id}`}>
              <Edit className="w-4 h-4 mr-2" />
              Edit Course
            </Link>
          </Button>
          <Button asChild>
            <Link to={`/teacher/course/${course.id}/content`}>
              <Upload className="w-4 h-4 mr-2" />
              Upload Content
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        {[
          { label: 'Enrollment Code', value: course.enrollmentCode },
          { label: 'Modules', value: String(course.modules.length) },
          { label: 'Status', value: course.visibility },
        ].map((stat) => (
          <Card key={stat.label} className="p-4 bg-card/50">
            <p className="text-sm text-muted-foreground">{stat.label}</p>
            <p className="text-xl font-bold mt-1">{stat.value}</p>
          </Card>
        ))}
      </div>

      {course.modules.length > 0 && (
        <Card className="p-6 bg-card/50">
          <h2 className="text-xl font-bold mb-4">Course Roadmap</h2>
          <div className="space-y-3">
            {course.modules.map((m, i) => (
              <div key={m.id} className="flex gap-4 p-3 rounded-xl bg-muted/20">
                <span className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold text-sm shrink-0">
                  {i + 1}
                </span>
                <div>
                  <p className="font-semibold">{m.title}</p>
                  <p className="text-sm text-muted-foreground">Week {m.week} · {m.duration}</p>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {m.topics.map((t) => (
                      <Badge key={t} variant="outline" className="text-xs">{t}</Badge>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="p-6 bg-card/50">
        <h2 className="text-xl font-bold mb-4">Learning Outcomes</h2>
        <div className="grid md:grid-cols-2 gap-6">
          <div>
            <h3 className="font-medium mb-2">CLOs</h3>
            <ul className="space-y-1 text-sm">
              {course.clos.map((c, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-primary">•</span>{c}
                </li>
              ))}
            </ul>
          </div>
          {course.plos.length > 0 && (
            <div>
              <h3 className="font-medium mb-2">PLOs</h3>
              <ul className="space-y-1 text-sm">
                {course.plos.map((p, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-secondary">•</span>{p}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

export function MyCoursesPage() {
  const { courseId } = useParams();
  const courses = useMemo(() => courseService.getAll(), []);
  const selected = courseId ? courseService.getById(courseId) : null;

  if (courseId && selected) {
    return (
      <div className="max-w-5xl mx-auto px-4 md:px-6 py-8">
        <Button variant="ghost" size="sm" className="mb-4" asChild>
          <Link to="/teacher/courses">← Back to all courses</Link>
        </Button>
        <CourseDetailView course={selected} />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 md:px-6 py-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold">My Courses</h1>
          <p className="text-muted-foreground mt-1">
            {courses.length} course{courses.length !== 1 ? 's' : ''} created
          </p>
        </div>
        <Button asChild>
          <Link to="/teacher/course/create">
            <Plus className="w-4 h-4 mr-2" />
            Create Course
          </Link>
        </Button>
      </div>

      {courses.length === 0 ? (
        <Card className="p-12 text-center bg-card/50">
          <BookOpen className="w-16 h-16 mx-auto mb-4 text-muted-foreground/40" />
          <h2 className="text-xl font-semibold mb-2">No courses yet</h2>
          <p className="text-muted-foreground mb-6">
            Create your first AI-powered course to get started
          </p>
          <Button asChild>
            <Link to="/teacher/course/create">
              <Plus className="w-4 h-4 mr-2" />
              Create Your First Course
            </Link>
          </Button>
        </Card>
      ) : (
        <div className="space-y-4">
          {courses.map((course) => (
            <CourseCard key={course.id} course={course} />
          ))}
        </div>
      )}
    </div>
  );
}
