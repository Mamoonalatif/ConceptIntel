import { motion } from 'motion/react';
import { Link } from 'react-router';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Progress } from '../components/ui/progress';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { getFriendlyDisplayName, getInitials } from '../services/authService';
import {
  Brain,
  Moon,
  Sun,
  BookOpen,
  TrendingUp,
  Award,
  Flame,
  Target,
  Clock,
  AlertCircle,
  Sparkles,
  BarChart3,
  Network
} from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const mockProgressData = [
  { day: 'Mon', mastery: 65 },
  { day: 'Tue', mastery: 68 },
  { day: 'Wed', mastery: 72 },
  { day: 'Thu', mastery: 70 },
  { day: 'Fri', mastery: 75 },
  { day: 'Sat', mastery: 78 },
  { day: 'Sun', mastery: 82 },
];

export function StudentDashboard() {
  const { theme, toggleTheme } = useTheme();
  const { user } = useAuth();
  const displayName = user ? getFriendlyDisplayName(user.full_name) : 'Student';
  const initials = user ? getInitials(user.full_name) : 'ST';

  return (
    <div className="min-h-screen">
      {/* Top Navigation */}
      <nav className="sticky top-0 z-50 backdrop-blur-md bg-card/80 border-b border-border">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center">
              <Brain className="w-6 h-6 text-white" />
            </div>
            <span className="text-xl font-bold">ConceptIntel</span>
          </div>

          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/student/gamification">
                <Award className="w-4 h-4 mr-2" />
                Rewards
              </Link>
            </Button>
            <Button variant="ghost" size="icon" onClick={toggleTheme}>
              {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </Button>
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center text-white font-medium">
              {initials}
            </div>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Welcome Section with AI Assistant */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-4xl font-bold mb-2">Welcome back, {displayName}! 👋</h1>
              <p className="text-muted-foreground">Let's continue your learning journey</p>
            </div>
            
            {/* AI Assistant Orb */}
            <motion.div
              animate={{
                scale: [1, 1.05, 1],
                opacity: [0.8, 1, 0.8],
              }}
              transition={{
                duration: 3,
                repeat: Infinity,
              }}
              className="relative"
            >
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center relative">
                <Sparkles className="w-8 h-8 text-white" />
                <div className="absolute inset-0 rounded-full bg-gradient-to-br from-primary to-secondary blur-xl opacity-50" />
              </div>
            </motion.div>
          </div>
        </motion.div>

        {/* Stats Overview */}
        <div className="grid md:grid-cols-4 gap-6 mb-8">
          {[
            { icon: Target, label: 'Overall Mastery', value: '82%', color: 'text-primary', bg: 'bg-primary/10' },
            { icon: Flame, label: 'Learning Streak', value: '12 days', color: 'text-orange-500', bg: 'bg-orange-500/10' },
            { icon: Award, label: 'XP Points', value: '4,250', color: 'text-secondary', bg: 'bg-secondary/10' },
            { icon: BookOpen, label: 'Active Courses', value: '5', color: 'text-purple-500', bg: 'bg-purple-500/10' },
          ].map((stat, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
            >
              <Card className="p-6 bg-card/50 backdrop-blur-sm border-border/50">
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
          {/* Left Column */}
          <div className="lg:col-span-2 space-y-8">
            {/* Continue Learning */}
            <Card className="p-6 bg-gradient-to-br from-primary/10 via-transparent to-secondary/5 border-border/50">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-2xl font-bold">Continue Learning</h2>
                <Button variant="ghost" size="sm">View All</Button>
              </div>
              
              <div className="space-y-4">
                {[
                  {
                    course: 'Data Structures & Algorithms',
                    topic: 'Binary Search Trees',
                    progress: 65,
                    nextAction: 'Practice Quiz',
                    time: '15 min'
                  },
                  {
                    course: 'Machine Learning',
                    topic: 'Neural Networks',
                    progress: 42,
                    nextAction: 'Watch Lecture',
                    time: '25 min'
                  }
                ].map((item, i) => (
                  <Card key={i} className="p-5 hover:shadow-lg transition-shadow cursor-pointer bg-card/80 backdrop-blur-sm">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h3 className="font-semibold">{item.course}</h3>
                        <p className="text-sm text-muted-foreground">{item.topic}</p>
                      </div>
                      <Button size="sm">
                        {item.nextAction}
                      </Button>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="flex-1">
                        <Progress value={item.progress} className="h-2" />
                      </div>
                      <div className="flex items-center gap-1 text-sm text-muted-foreground">
                        <Clock className="w-4 h-4" />
                        {item.time}
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </Card>

            {/* Active Courses */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-2xl font-bold">Your Courses</h2>
                <Button variant="outline" size="sm" asChild>
                  <Link to="/student/enroll">+ Enroll</Link>
                </Button>
              </div>
              
              <div className="grid md:grid-cols-2 gap-4">
                {[
                  { name: 'Data Structures', progress: 65, mastery: 72, concepts: 45 },
                  { name: 'Machine Learning', progress: 42, mastery: 58, concepts: 67 },
                  { name: 'Web Development', progress: 88, mastery: 85, concepts: 52 },
                  { name: 'Database Systems', progress: 30, mastery: 45, concepts: 38 }
                ].map((course, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: i * 0.1 }}
                  >
                    <Card className="p-5 hover:shadow-lg transition-all cursor-pointer group bg-card/50 backdrop-blur-sm border-border/50">
                      <div className="flex items-start justify-between mb-4">
                        <div>
                          <h3 className="font-semibold group-hover:text-primary transition-colors">{course.name}</h3>
                          <p className="text-sm text-muted-foreground">{course.concepts} concepts</p>
                        </div>
                        <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                          <Network className="w-6 h-6 text-primary" />
                        </div>
                      </div>
                      
                      <div className="space-y-3">
                        <div>
                          <div className="flex items-center justify-between text-sm mb-1">
                            <span className="text-muted-foreground">Progress</span>
                            <span className="font-medium">{course.progress}%</span>
                          </div>
                          <Progress value={course.progress} className="h-2" />
                        </div>
                        
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">Mastery</span>
                          <span className={`font-medium ${course.mastery >= 70 ? 'text-[#22C55E]' : course.mastery >= 50 ? 'text-[#F59E0B]' : 'text-[#EF4444]'}`}>
                            {course.mastery}%
                          </span>
                        </div>
                      </div>
                    </Card>
                  </motion.div>
                ))}
              </div>
            </div>

            {/* Progress Chart */}
            <Card className="p-6 bg-card/50 backdrop-blur-sm border-border/50">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold">Your Progress</h2>
                <Button variant="ghost" size="sm">
                  <BarChart3 className="w-4 h-4 mr-2" />
                  Analytics
                </Button>
              </div>
              
              <ResponsiveContainer width="100%" height={250}>
                <AreaChart data={mockProgressData}>
                  <defs>
                    <linearGradient id="masteryGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
                  <XAxis dataKey="day" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '0.75rem',
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="mastery"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    fill="url(#masteryGradient)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </Card>
          </div>

          {/* Right Column */}
          <div className="space-y-6">
            {/* Weak Concepts */}
            <Card className="p-6 bg-card/50 backdrop-blur-sm border-border/50">
              <div className="flex items-center gap-2 mb-4">
                <AlertCircle className="w-5 h-5 text-[#EF4444]" />
                <h2 className="text-xl font-bold">Needs Attention</h2>
              </div>
              
              <div className="space-y-3">
                {[
                  { concept: 'Graph Traversal', mastery: 45, course: 'Data Structures' },
                  { concept: 'Gradient Descent', mastery: 38, course: 'Machine Learning' },
                  { concept: 'SQL Joins', mastery: 52, course: 'Database Systems' }
                ].map((item, i) => (
                  <div key={i} className="p-3 rounded-xl bg-[#EF4444]/5 border border-[#EF4444]/20">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-sm">{item.concept}</span>
                      <span className="text-sm text-[#EF4444] font-medium">{item.mastery}%</span>
                    </div>
                    <div className="text-xs text-muted-foreground mb-2">{item.course}</div>
                    <Button size="sm" variant="outline" className="w-full">
                      Review Now
                    </Button>
                  </div>
                ))}
              </div>
            </Card>

            {/* Upcoming Assignments */}
            <Card className="p-6 bg-card/50 backdrop-blur-sm border-border/50">
              <h2 className="text-xl font-bold mb-4">Upcoming</h2>
              
              <div className="space-y-3">
                {[
                  { title: 'DSA Assignment #3', due: '2 days', course: 'Data Structures' },
                  { title: 'ML Project Submission', due: '5 days', course: 'Machine Learning' },
                  { title: 'Database Quiz', due: '1 week', course: 'Database Systems' }
                ].map((item, i) => (
                  <div key={i} className="p-4 rounded-xl bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer">
                    <div className="flex items-start justify-between mb-1">
                      <h4 className="font-medium">{item.title}</h4>
                      <span className="text-xs px-2 py-1 rounded-full bg-primary/10 text-primary">
                        {item.due}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">{item.course}</p>
                  </div>
                ))}
              </div>
            </Card>

            {/* AI Recommendations */}
            <Card className="p-6 bg-gradient-to-br from-primary/10 via-transparent to-secondary/5 border-primary/20">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center">
                  <Sparkles className="w-4 h-4 text-white" />
                </div>
                <h2 className="text-xl font-bold">AI Suggests</h2>
              </div>
              
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Based on your learning patterns, we recommend:
                </p>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-start gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5" />
                    <span>Practice more graph algorithms this week</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-secondary mt-1.5" />
                    <span>Review neural networks before the quiz</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5" />
                    <span>Complete 3 SQL practice problems daily</span>
                  </li>
                </ul>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
