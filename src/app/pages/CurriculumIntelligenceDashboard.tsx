import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Brain, Network, Target, TrendingUp, BookOpen, Users, ClipboardCheck } from 'lucide-react';
import { Link } from 'react-router';
import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar } from 'recharts';
import { supervisionService } from '../services/supervisionService';
import type { SupervisionStats } from '../types/supervision';

const curriculumCoverage = [
  { subject: 'Data Structures', value: 92 },
  { subject: 'Algorithms', value: 88 },
  { subject: 'Complexity', value: 95 },
  { subject: 'Problem Solving', value: 85 },
  { subject: 'Optimization', value: 78 },
];

export function CurriculumIntelligenceDashboard() {
  const [stats, setStats] = useState<SupervisionStats | null>(null);

  useEffect(() => {
    supervisionService.getStats().then(setStats).catch(() => setStats(null));
  }, []);

  return (
    <div className="min-h-screen">
      <nav className="sticky top-0 z-50 backdrop-blur-md bg-card/80 border-b border-border">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center">
              <Brain className="w-6 h-6 text-white" />
            </div>
            <span className="text-xl font-bold">ConceptIntel</span>
          </div>
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-orange-500 to-red-500 flex items-center justify-center text-white font-medium">
            CC
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-4xl font-bold mb-2">Curriculum Intelligence</h1>
            <p className="text-muted-foreground">Monitor curriculum consistency and knowledge alignment</p>
          </div>
          <Button asChild>
            <Link to="/coordinator/supervision">
              <ClipboardCheck className="w-4 h-4 mr-2" />
              Review AI Content
            </Link>
          </Button>
        </div>

        <div className="grid md:grid-cols-4 gap-6 mb-8">
          {[
            { icon: BookOpen, label: 'Active Courses', value: '24', color: 'text-primary' },
            { icon: Users, label: 'Teachers', value: '18', color: 'text-secondary' },
            { icon: ClipboardCheck, label: 'Pending AI Reviews', value: String(stats?.pending_review ?? 0), color: 'text-[#F59E0B]' },
            { icon: Target, label: 'Approved Content', value: String(stats?.approved ?? 0), color: 'text-[#22C55E]' },
          ].map((stat, i) => (
            <Card key={i} className="p-6 bg-card/50">
              <div className={`w-12 h-12 rounded-xl bg-${stat.color.replace('text-', '')}/10 flex items-center justify-center mb-4`}>
                <stat.icon className={`w-6 h-6 ${stat.color}`} />
              </div>
              <div className="text-3xl font-bold mb-1">{stat.value}</div>
              <div className="text-sm text-muted-foreground">{stat.label}</div>
            </Card>
          ))}
        </div>

        <div className="grid lg:grid-cols-2 gap-8">
          {/* Curriculum Coverage */}
          <Card className="p-6 bg-card/50">
            <h2 className="text-2xl font-bold mb-6">Curriculum Coverage</h2>
            <ResponsiveContainer width="100%" height={300}>
              <RadarChart data={curriculumCoverage}>
                <PolarGrid stroke="hsl(var(--border))" />
                <PolarAngleAxis dataKey="subject" stroke="hsl(var(--foreground))" fontSize={12} />
                <PolarRadiusAxis stroke="hsl(var(--muted-foreground))" />
                <Radar name="Coverage" dataKey="value" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.3} />
              </RadarChart>
            </ResponsiveContainer>
          </Card>

          {/* Course Alignment */}
          <Card className="p-6 bg-card/50">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold">Course Alignment</h2>
              <Button variant="outline" size="sm" asChild>
                <Link to="/coordinator/knowledge-graph">View Graph</Link>
              </Button>
            </div>
            
            <div className="space-y-4">
              {[
                { course: 'Data Structures', alignment: 95, concepts: 45 },
                { course: 'Algorithms', alignment: 88, concepts: 52 },
                { course: 'Systems Design', alignment: 92, concepts: 38 },
                { course: 'Machine Learning', alignment: 85, concepts: 67 },
              ].map((item, i) => (
                <div key={i} className="p-4 rounded-xl bg-muted/30">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-medium">{item.course}</h4>
                    <span className={`text-sm font-semibold ${
                      item.alignment >= 90 ? 'text-[#22C55E]' :
                      item.alignment >= 80 ? 'text-[#F59E0B]' : 'text-[#EF4444]'
                    }`}>
                      {item.alignment}%
                    </span>
                  </div>
                  <div className="text-sm text-muted-foreground mb-2">{item.concepts} concepts</div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className={`h-full ${
                        item.alignment >= 90 ? 'bg-[#22C55E]' :
                        item.alignment >= 80 ? 'bg-[#F59E0B]' : 'bg-[#EF4444]'
                      }`}
                      style={{ width: `${item.alignment}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Concept Dependencies */}
          <Card className="p-6 bg-card/50">
            <h2 className="text-2xl font-bold mb-6">Cross-Course Dependencies</h2>
            <div className="space-y-3">
              {[
                { from: 'Data Structures', to: 'Algorithms', strength: 'Strong' },
                { from: 'Algorithms', to: 'Machine Learning', strength: 'Medium' },
                { from: 'Data Structures', to: 'Systems Design', strength: 'Strong' },
              ].map((dep, i) => (
                <div key={i} className="p-4 rounded-xl bg-muted/30">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm font-medium">{dep.from}</span>
                    <span className="text-muted-foreground">→</span>
                    <span className="text-sm font-medium">{dep.to}</span>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    dep.strength === 'Strong' ? 'bg-[#22C55E]/10 text-[#22C55E]' :
                    'bg-[#F59E0B]/10 text-[#F59E0B]'
                  }`}>
                    {dep.strength} Dependency
                  </span>
                </div>
              ))}
            </div>
          </Card>

          {/* Curriculum Gaps */}
          <Card className="p-6 bg-card/50">
            <h2 className="text-2xl font-bold mb-6">Identified Gaps</h2>
            <div className="space-y-3">
              {[
                { area: 'Advanced Graph Algorithms', severity: 'high' },
                { area: 'Parallel Processing Concepts', severity: 'medium' },
                { area: 'Distributed Systems', severity: 'low' },
              ].map((gap, i) => (
                <div key={i} className="p-4 rounded-xl bg-[#EF4444]/5 border border-[#EF4444]/20">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{gap.area}</span>
                    <span className={`text-xs px-2 py-1 rounded-full ${
                      gap.severity === 'high' ? 'bg-[#EF4444]/10 text-[#EF4444]' :
                      gap.severity === 'medium' ? 'bg-[#F59E0B]/10 text-[#F59E0B]' :
                      'bg-[#22C55E]/10 text-[#22C55E]'
                    }`}>
                      {gap.severity}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <Button variant="outline" className="w-full mt-4">
              Generate Recommendations
            </Button>
          </Card>
        </div>
      </div>
    </div>
  );
}
