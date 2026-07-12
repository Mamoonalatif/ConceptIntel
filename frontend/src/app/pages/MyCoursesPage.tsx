import { useEffect, useState } from 'react';
import { Link, useParams, useLocation } from 'react-router';
import { motion } from 'motion/react';
import {
  BookOpen,
  Plus,
  Calendar,
  Edit,
  Trash2,
  Upload,
  Network,
  Users,
  Copy,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { courseService } from '../services/courseService';
import { MOCK_USER_IDS } from '../config/mockUsers';
import { SEMESTERS, type Course, type UserCourseRole } from '../types/course';

// This page is only reachable by Teacher (their own classes) and Admin (everything) —
// Coordinator and HOD have their own dedicated views (CourseCoordinatorOverviewPage,
// CatalogManagementPage) since "courses" mean something different for each role.
function roleFromPath(pathname: string): UserCourseRole {
  return pathname.startsWith('/admin') ? 'admin' : 'teacher';
}

function CourseCard({ course, role, basePath }: { course: Course; role: UserCourseRole; basePath: string }) {
  const canManage = role === 'admin';
  const semesterLabel = SEMESTERS.find((s) => s.value === course.semester)?.label ?? course.semester;

  const handleDelete = async () => {
    if (confirm(`Delete "${course.courseName}"? This cannot be undone.`)) {
      await courseService.delete(course.id);
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
          <div className="md:w-48 h-32 md:h-auto bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center shrink-0">
            <BookOpen className="w-10 h-10 text-primary/50" />
          </div>

          <div className="flex-1 p-5">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-3">
              <div>
                <Link to={`${basePath}/${course.id}`}>
                  <h3 className="text-lg font-bold hover:text-primary transition-colors">
                    {course.courseName}
                  </h3>
                </Link>
                <div className="flex flex-wrap gap-2 mt-2">
                  <Badge variant="outline" className="font-mono">{course.courseCode}</Badge>
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
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button size="sm" variant="outline" asChild>
                  <Link to={`${basePath.replace(/\/courses$/, '')}/course/create?edit=${course.id}`}>
                    <Edit className="w-4 h-4" />
                  </Link>
                </Button>
                {canManage && (
                  <Button size="sm" variant="outline" onClick={handleDelete}>
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                )}
              </div>
            </div>

            {course.description && (
              <p className="text-sm text-muted-foreground line-clamp-2 mb-3">{course.description}</p>
            )}

            <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground mb-4">
              <span className="flex items-center gap-1">
                <Calendar className="w-4 h-4" />
                {course.courseStartDate} — {course.courseEndDate}
              </span>
              <span>Prerequisite: {course.prerequisite}</span>
              <span className="flex items-center gap-1">
                <Users className="w-4 h-4" />
                {course.enrolledCount} enrolled{course.maxStudents ? ` / ${course.maxStudents} max` : ''}
              </span>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={copyCode}>
                <Copy className="w-3 h-3 mr-1" />
                {course.enrollmentCode}
              </Button>
              <Button size="sm" variant="outline" asChild>
                <Link to={`${basePath.replace(/\/courses$/, '')}/course/${course.id}/content`}>
                  <Upload className="w-3 h-3 mr-1" />
                  Upload Content
                </Link>
              </Button>
              <Button size="sm" variant="outline" asChild>
                <Link to={`${basePath.replace(/\/courses$/, '')}/course/${course.id}/knowledge-graph`}>
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

function CourseDetailView({ course, role }: { course: Course; role: UserCourseRole }) {
  const canManage = role === 'admin';
  const semesterLabel = SEMESTERS.find((s) => s.value === course.semester)?.label ?? course.semester;

  const copyCode = () => {
    navigator.clipboard.writeText(course.enrollmentCode);
    toast.success('Enrollment code copied');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">{course.courseName}</h1>
          <p className="text-muted-foreground mt-1">
            {course.courseCode} · {semesterLabel} · Created{' '}
            {new Date(course.createdAt).toLocaleDateString()}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link to={`/${role}/course/create?edit=${course.id}`}>
              <Edit className="w-4 h-4 mr-2" />
              Edit Course
            </Link>
          </Button>
          <Button asChild>
            <Link to={`/${role}/course/${course.id}/content`}>
              <Upload className="w-4 h-4 mr-2" />
              Upload Content
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid md:grid-cols-4 gap-4">
        {[
          { label: 'Prerequisite', value: course.prerequisite },
          { label: 'Status', value: course.visibility },
          {
            label: 'Enrolled Students',
            value: `${course.enrolledCount}${course.maxStudents ? ` / ${course.maxStudents}` : ''}`,
          },
          { label: 'Enrollment Window', value: `${course.enrollmentStartDate} → ${course.enrollmentEndDate}` },
        ].map((stat) => (
          <Card key={stat.label} className="p-4 bg-card/50">
            <p className="text-sm text-muted-foreground">{stat.label}</p>
            <p className="text-lg font-bold mt-1 capitalize">{stat.value}</p>
          </Card>
        ))}
      </div>

      <Card className="p-6 bg-card/50">
        <h2 className="text-xl font-bold mb-4">Course Details</h2>
        <div className="grid md:grid-cols-2 gap-6 text-sm">
          <div>
            <p className="text-muted-foreground mb-1">Description</p>
            <p>{course.description || '—'}</p>
          </div>
          <div>
            <p className="text-muted-foreground mb-1">Course Duration</p>
            <p>{course.courseStartDate} → {course.courseEndDate}</p>
          </div>
          <div>
            <p className="text-muted-foreground mb-1">Enrollment Code</p>
            <div className="flex items-center gap-2">
              <p className="font-mono font-semibold">{course.enrollmentCode}</p>
              <Button size="sm" variant="ghost" onClick={copyCode}>
                <Copy className="w-3 h-3" />
              </Button>
            </div>
          </div>
          <div>
            <p className="text-muted-foreground mb-1">Invite Link</p>
            <p className="font-mono text-xs break-all">{course.inviteLink}</p>
          </div>
        </div>
        {!canManage && (
          <p className="text-xs text-muted-foreground mt-4">
            Course name, code, and prerequisite mappings are managed by a Course Coordinator or Admin.
          </p>
        )}
      </Card>
    </div>
  );
}

export function MyCoursesPage() {
  const { courseId } = useParams();
  const location = useLocation();
  const role = roleFromPath(location.pathname);
  const basePath = `/${role}/courses`;
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const filters = role === 'teacher' ? { teacherId: MOCK_USER_IDS.teacher } : undefined;
    courseService
      .getAll(filters)
      .then(setCourses)
      .finally(() => setLoading(false));
  }, [role]);

  const selected = courseId ? courses.find((c) => c.id === courseId) : null;

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 md:px-6 py-8">
        <p className="text-muted-foreground">Loading courses…</p>
      </div>
    );
  }

  if (courseId && selected) {
    return (
      <div className="max-w-5xl mx-auto px-4 md:px-6 py-8">
        <Button variant="ghost" size="sm" className="mb-4" asChild>
          <Link to={basePath}>← Back to all courses</Link>
        </Button>
        <CourseDetailView course={selected} role={role} />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 md:px-6 py-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold">{role === 'teacher' ? 'My Classes' : 'All Courses'}</h1>
          <p className="text-muted-foreground mt-1">
            {role === 'teacher'
              ? `${courses.length} class${courses.length !== 1 ? 'es' : ''} you've created`
              : `${courses.length} course${courses.length !== 1 ? 's' : ''} across all teachers`}
          </p>
        </div>
        <Button asChild>
          <Link to={`/${role}/course/create`}>
            <Plus className="w-4 h-4 mr-2" />
            {role === 'teacher' ? 'Create Class' : 'Create Course'}
          </Link>
        </Button>
      </div>

      {courses.length === 0 ? (
        <Card className="p-12 text-center bg-card/50">
          <BookOpen className="w-16 h-16 mx-auto mb-4 text-muted-foreground/40" />
          <h2 className="text-xl font-semibold mb-2">
            {role === 'teacher' ? "You haven't created a class yet" : 'No courses yet'}
          </h2>
          <p className="text-muted-foreground mb-6">
            {role === 'teacher'
              ? 'Pick a course from the catalog and set up your class — you\'ll get a unique enrollment code and link'
              : 'No teacher has created a course offering yet'}
          </p>
          <Button asChild>
            <Link to={`/${role}/course/create`}>
              <Plus className="w-4 h-4 mr-2" />
              {role === 'teacher' ? 'Create Your First Class' : 'Create Course'}
            </Link>
          </Button>
        </Card>
      ) : (
        <div className="space-y-4">
          {courses.map((course) => (
            <CourseCard key={course.id} course={course} role={role} basePath={basePath} />
          ))}
        </div>
      )}
    </div>
  );
}
