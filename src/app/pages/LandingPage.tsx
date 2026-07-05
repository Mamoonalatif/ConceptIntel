import { motion } from 'motion/react';
import { Link } from 'react-router';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { useTheme } from '../context/ThemeContext';
import { 
  Brain, 
  Moon, 
  Sun, 
  Sparkles, 
  Network, 
  TrendingUp, 
  Target,
  Users,
  BookOpen,
  Zap,
  Award,
  LineChart
} from 'lucide-react';

export function LandingPage() {
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="min-h-screen">
      {/* Navigation */}
      <nav className="fixed top-0 w-full z-50 backdrop-blur-md bg-background/80 border-b border-border">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center">
              <Brain className="w-6 h-6 text-white" />
            </div>
            <span className="text-2xl font-bold bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
              ConceptIntel
            </span>
          </div>
          
          <div className="flex items-center gap-4">
            <Button variant="ghost" onClick={toggleTheme} size="icon">
              {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </Button>
            <Button variant="ghost" asChild>
              <Link to="/login">Login</Link>
            </Button>
            <Button asChild>
              <Link to="/signup">Get Started</Link>
            </Button>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="pt-32 pb-20 px-6">
        <div className="max-w-7xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="text-center max-w-4xl mx-auto"
          >
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary mb-6">
              <Sparkles className="w-4 h-4" />
              <span className="text-sm font-medium">AI-Powered Adaptive Learning</span>
            </div>
            
            <h1 className="text-6xl font-bold mb-6 leading-tight">
              The Future of{' '}
              <span className="bg-gradient-to-r from-primary via-secondary to-primary bg-clip-text text-transparent">
                Intelligent Education
              </span>
            </h1>
            
            <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
              ConceptIntel transforms learning with AI-powered knowledge graphs, 
              adaptive pathways, and real-time analytics for universities.
            </p>
            
            <div className="flex items-center justify-center gap-4">
              <Button size="lg" className="rounded-full px-8" asChild>
                <Link to="/signup">Start Learning Today</Link>
              </Button>
              <Button size="lg" variant="outline" className="rounded-full px-8">
                Watch Demo
              </Button>
            </div>
          </motion.div>

          {/* Animated Knowledge Graph Visual */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="mt-16 relative"
          >
            <div className="relative rounded-3xl overflow-hidden border border-border bg-card/50 backdrop-blur-sm p-12">
              <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-secondary/5" />
              
              {/* Animated Nodes */}
              <div className="relative h-96 flex items-center justify-center">
                {[...Array(5)].map((_, i) => (
                  <motion.div
                    key={i}
                    className="absolute"
                    style={{
                      left: `${20 + i * 15}%`,
                      top: `${30 + Math.sin(i) * 20}%`,
                    }}
                    animate={{
                      y: [0, -10, 0],
                      opacity: [0.5, 1, 0.5],
                    }}
                    transition={{
                      duration: 3,
                      repeat: Infinity,
                      delay: i * 0.2,
                    }}
                  >
                    <div className="w-16 h-16 rounded-2xl bg-primary/20 backdrop-blur-sm border border-primary/40 flex items-center justify-center">
                      <Network className="w-8 h-8 text-primary" />
                    </div>
                  </motion.div>
                ))}
                
                {/* Connecting Lines */}
                <svg className="absolute inset-0 w-full h-full" style={{ opacity: 0.3 }}>
                  <line x1="20%" y1="30%" x2="35%" y2="40%" stroke="currentColor" strokeWidth="2" className="text-primary" />
                  <line x1="35%" y1="40%" x2="50%" y2="35%" stroke="currentColor" strokeWidth="2" className="text-secondary" />
                  <line x1="50%" y1="35%" x2="65%" y2="45%" stroke="currentColor" strokeWidth="2" className="text-primary" />
                </svg>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 px-6 bg-muted/30">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold mb-4">Intelligent Learning Features</h2>
            <p className="text-xl text-muted-foreground">
              Powered by AI to transform educational experiences
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                icon: Brain,
                title: 'AI-Powered Learning',
                description: 'Adaptive algorithms personalize your learning journey in real-time'
              },
              {
                icon: Network,
                title: 'Knowledge Graphs',
                description: 'Visualize interconnected concepts and prerequisites dynamically'
              },
              {
                icon: TrendingUp,
                title: 'Progress Analytics',
                description: 'Track mastery levels with intelligent insights and recommendations'
              },
              {
                icon: Target,
                title: 'Adaptive Pathways',
                description: 'AI generates personalized learning paths based on your progress'
              },
              {
                icon: Award,
                title: 'Smart Gamification',
                description: 'Earn XP, badges, and streaks with mature motivational design'
              },
              {
                icon: Zap,
                title: 'Instant Feedback',
                description: 'Get explainable AI feedback on assignments and quizzes'
              }
            ].map((feature, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                viewport={{ once: true }}
              >
                <Card className="p-6 h-full hover:shadow-lg transition-shadow duration-300 bg-card/80 backdrop-blur-sm border-border/50">
                  <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
                    <feature.icon className="w-6 h-6 text-primary" />
                  </div>
                  <h3 className="text-xl font-semibold mb-2">{feature.title}</h3>
                  <p className="text-muted-foreground">{feature.description}</p>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Role-Based Experience */}
      <section className="py-20 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold mb-4">Built for Every Role</h2>
            <p className="text-xl text-muted-foreground">
              Tailored experiences for students, teachers, coordinators, and admins
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              {
                role: 'Students',
                icon: Users,
                color: 'from-blue-500 to-cyan-500',
                features: ['Adaptive Learning', 'Progress Tracking', 'Gamification', 'Smart Quizzes']
              },
              {
                role: 'Teachers',
                icon: BookOpen,
                color: 'from-purple-500 to-pink-500',
                features: ['Course Creation', 'AI Grading', 'Analytics', 'Content Upload']
              },
              {
                role: 'Coordinators',
                icon: Target,
                color: 'from-orange-500 to-red-500',
                features: ['Curriculum Intelligence', 'Graph Supervision', 'Alignment', 'Governance']
              },
              {
                role: 'Admins',
                icon: LineChart,
                color: 'from-green-500 to-teal-500',
                features: ['System Management', 'User Control', 'Reports', 'Monitoring']
              }
            ].map((item, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, scale: 0.95 }}
                whileInView={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                viewport={{ once: true }}
              >
                <Card className="p-6 h-full bg-card/80 backdrop-blur-sm border-border/50 hover:shadow-xl transition-all duration-300">
                  <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${item.color} flex items-center justify-center mb-4`}>
                    <item.icon className="w-8 h-8 text-white" />
                  </div>
                  <h3 className="text-2xl font-bold mb-4">{item.role}</h3>
                  <ul className="space-y-2">
                    {item.features.map((feature, j) => (
                      <li key={j} className="flex items-center gap-2 text-muted-foreground">
                        <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                        {feature}
                      </li>
                    ))}
                  </ul>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Statistics */}
      <section className="py-20 px-6 bg-gradient-to-br from-primary/5 via-transparent to-secondary/5">
        <div className="max-w-7xl mx-auto">
          <div className="grid md:grid-cols-4 gap-8 text-center">
            {[
              { value: '50K+', label: 'Active Students' },
              { value: '2K+', label: 'Courses' },
              { value: '95%', label: 'Satisfaction' },
              { value: '1M+', label: 'Concepts Mastered' }
            ].map((stat, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                viewport={{ once: true }}
              >
                <div className="text-5xl font-bold bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent mb-2">
                  {stat.value}
                </div>
                <div className="text-muted-foreground">{stat.label}</div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <Card className="p-12 bg-gradient-to-br from-primary/10 via-transparent to-secondary/10 border-border/50">
            <h2 className="text-4xl font-bold mb-4">Ready to Transform Learning?</h2>
            <p className="text-xl text-muted-foreground mb-8">
              Join thousands of students and educators using ConceptIntel
            </p>
            <div className="flex items-center justify-center gap-4">
              <Button size="lg" className="rounded-full px-8" asChild>
                <Link to="/signup">Get Started Free</Link>
              </Button>
              <Button size="lg" variant="outline" className="rounded-full px-8">
                Schedule Demo
              </Button>
            </div>
          </Card>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-6 border-t border-border">
        <div className="max-w-7xl mx-auto text-center text-muted-foreground">
          <p>© 2026 ConceptIntel. The future of intelligent education.</p>
        </div>
      </footer>
    </div>
  );
}
