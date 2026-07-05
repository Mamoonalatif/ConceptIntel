import { motion } from 'motion/react';
import { Link } from 'react-router';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Brain, Users, BookOpen, FileText, TrendingUp, AlertCircle, Plus } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { courseService } from '../services/courseService';

const mockData = [
  { week: 'W1', mastery: 75 },
  { week: 'W2', mastery: 78 },
  { week: 'W3', mastery: 72 },
  { week: 'W4', mastery: 80 },
];

export function TeacherDashboard() {
  const courses = courseService.getAll().slice(0, 5);

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-8">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold mb-2">Welcome, Dr. Smith 👋</h1>
            <p className="text-muted-foreground">Manage your courses and monitor student progress</p>
          </div>
          <Button size="lg" asChild>
            <Link to="/teacher/course/create">
              <Plus className="w-4 h-4 mr-2" />
              Create Course
            </Link>
          </Button>
        </div>
      </motion.div>

      <div className="grid md:grid-cols-4 gap-6 mb-8">
        {[
          { icon: BookOpen, label: 'Active Courses', value: String(courses.filter(c => c.visibility === 'open').length || courses.length), color: 'text-primary', bg: 'bg-primary/10' },
          { icon: Users, label: 'Total Students', value: '342', color: 'text-secondary', bg: 'bg-secondary/10' },
          { icon: FileText, label: 'Pending Reviews', value: '12', color: 'text-warning', bg: 'bg-warning/10' },
          { icon: TrendingUp, label: 'Avg. Performance', value: '78%', color: 'text-success', bg: 'bg-success/10' },
        ].map((stat, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
          >
            <Card className="p-6 bg-card/50 backdrop-blur-sm">
              <div className={`w-12 h-12 rounded-xl ${stat.bg} flex items-center justify-center mb-4`}>
                <stat.icon className={`w-6 h-6 ${stat.color}`} />
              </div>
              <div className="text-3xl font-bold mb-1">{stat.value}</div>
              <div className="text-sm text-muted-foreground">{stat.label}</div>
            </Card>
          </motion.div>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold">Your Courses</h2>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/teacher/courses">View all</Link>
            </Button>
          </div>

          <div className="space-y-4">
            {courses.length === 0 ? (
              <Card className="p-8 text-center bg-card/50">
                <Brain className="w-12 h-12 mx-auto mb-3 text-primary/40" />
                <p className="text-muted-foreground mb-4">No courses created yet</p>
                <Button asChild>
                  <Link to="/teacher/course/create">Create Your First Course</Link>
                </Button>
              </Card>
            ) : (
              courses.map((course, i) => (
                <motion.div
                  key={course.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.1 }}
                >
                  <Card className="p-6 hover:shadow-lg transition-shadow bg-card/50">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="text-xl font-semibold mb-1">{course.title}</h3>
                        <p className="text-sm text-muted-foreground">
                          {course.modules.length} modules · {course.visibility}
                        </p>
                      </div>
                      <Button asChild>
                        <Link to={`/teacher/course/${course.id}/content`}>Manage</Link>
                      </Button>
                    </div>
                    <div className="grid grid-cols-3 gap-4 text-sm">
                      <div>
                        <div className="text-muted-foreground mb-1">Code</div>
                        <div className="font-mono font-semibold text-sm">{course.enrollmentCode}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground mb-1">CLOs</div>
                        <div className="font-semibold text-lg">{course.clos.length}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground mb-1">Status</div>
                        <div className="font-semibold text-lg capitalize">{course.visibility}</div>
                      </div>
                    </div>
                  </Card>
                </motion.div>
              ))
            )}
          </div>

          <Card className="p-6 bg-card/50">
            <h2 className="text-2xl font-bold mb-6">Class Performance Trend</h2>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={mockData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
                <XAxis dataKey="week" stroke="hsl(var(--muted-foreground))" />
                <YAxis stroke="hsl(var(--muted-foreground))" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '0.75rem',
                  }}
                />
                <Bar dataKey="mastery" fill="hsl(var(--primary))" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="p-6 bg-card/50">
            <div className="flex items-center gap-2 mb-4">
              <AlertCircle className="w-5 h-5 text-warning" />
              <h2 className="text-xl font-bold">Pending Reviews</h2>
            </div>
            <div className="space-y-3">
              {[
                { student: 'John Doe', assignment: 'DSA Assignment 3', time: '2h ago' },
                { student: 'Jane Smith', assignment: 'ML Project', time: '5h ago' },
              ].map((item, i) => (
                <div key={i} className="p-3 rounded-xl bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer">
                  <div className="font-medium text-sm mb-1">{item.student}</div>
                  <div className="text-xs text-muted-foreground">{item.assignment}</div>
                </div>
              ))}
            </div>
            <Button variant="outline" className="w-full mt-4" asChild>
              <Link to="/teacher/assignment/1/evaluate">View All</Link>
            </Button>
          </Card>

          <Card className="p-6 bg-card/50">
            <h2 className="text-xl font-bold mb-4">Class Weak Spots</h2>
            <div className="space-y-3">
              {[
                { concept: 'Graph Traversal', percentage: 48 },
                { concept: 'Dynamic Programming', percentage: 52 },
              ].map((item, i) => (
                <div key={i} className="p-3 rounded-xl bg-destructive/5 border border-destructive/20">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{item.concept}</span>
                    <span className="text-sm font-semibold text-destructive">{item.percentage}%</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
