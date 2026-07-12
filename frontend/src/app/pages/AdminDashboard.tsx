import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Brain, Users, BookOpen, TrendingUp, Settings, Shield, UserPlus, Mail } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';

const userGrowth = [
  { month: 'Jan', users: 450 },
  { month: 'Feb', users: 520 },
  { month: 'Mar', users: 680 },
  { month: 'Apr', users: 820 },
  { month: 'May', users: 950 },
];

export function AdminDashboard() {
  const [showTeacherForm, setShowTeacherForm] = useState(false);
  const [teacherName, setTeacherName] = useState('');
  const [teacherEmail, setTeacherEmail] = useState('');
  const [loading, setLoading] = useState(false);

  const handleCreateTeacher = async (e: React.FormEvent) => {
    e.preventDefault();

    // Name validation
    const nameRegex = /^[a-zA-Z\s]+$/;
    if (!nameRegex.test(teacherName)) {
      toast.error('Name can only contain letters and spaces');
      return;
    }

    setLoading(true);
    try {
      const API_BASE = import.meta.env.VITE_API_URL ?? '/api';
      const res = await fetch(`${API_BASE}/auth/admin/create-teacher`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('conceptintel_token')}`,
        },
        body: JSON.stringify({ full_name: teacherName, email: teacherEmail }),
      });

      const data = await res.json();

      if (!res.ok) {
        const detail = data.detail;
        let message = 'Failed to create teacher';
        if (typeof detail === 'string') {
          message = detail;
        }
        throw new Error(message);
      }

      toast.success('Teacher created successfully! They can now set up their password.');
      setTeacherName('');
      setTeacherEmail('');
      setShowTeacherForm(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create teacher');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen">
      <nav className="sticky top-0 z-50 backdrop-blur-md bg-card/80 border-b border-border">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center">
              <Brain className="w-6 h-6 text-white" />
            </div>
            <span className="text-xl font-bold">ConceptIntel Admin</span>
          </div>
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon"><Settings className="w-5 h-5" /></Button>
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-green-500 to-teal-500 flex items-center justify-center text-white font-medium">
              AD
            </div>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2">Platform Overview</h1>
          <p className="text-muted-foreground">Monitor and manage the entire ecosystem</p>
        </div>

        <div className="grid md:grid-cols-4 gap-6 mb-8">
          {[
            { icon: Users, label: 'Total Users', value: '1,247', change: '+12%', color: 'text-primary' },
            { icon: BookOpen, label: 'Active Courses', value: '156', change: '+8%', color: 'text-secondary' },
            { icon: TrendingUp, label: 'Platform Usage', value: '89%', change: '+5%', color: 'text-[#22C55E]' },
            { icon: Shield, label: 'System Health', value: '98%', change: '0%', color: 'text-[#22C55E]' },
          ].map((stat, i) => (
            <Card key={i} className="p-6 bg-card/50">
              <div className={`w-12 h-12 rounded-xl bg-${stat.color.replace('text-', '')}/10 flex items-center justify-center mb-4`}>
                <stat.icon className={`w-6 h-6 ${stat.color}`} />
              </div>
              <div className="text-3xl font-bold mb-1">{stat.value}</div>
              <div className="flex items-center justify-between">
                <div className="text-sm text-muted-foreground">{stat.label}</div>
                <div className="text-xs text-[#22C55E]">{stat.change}</div>
              </div>
            </Card>
          ))}
        </div>

        <div className="grid lg:grid-cols-2 gap-8 mb-8">
          <Card className="p-6 bg-card/50">
            <h2 className="text-2xl font-bold mb-6">User Growth</h2>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={userGrowth}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
                <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" />
                <YAxis stroke="hsl(var(--muted-foreground))" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '0.75rem',
                  }}
                />
                <Line type="monotone" dataKey="users" stroke="hsl(var(--primary))" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </Card>

          <Card className="p-6 bg-card/50">
            <h2 className="text-2xl font-bold mb-6">User Distribution</h2>
            <div className="space-y-4">
              {[
                { role: 'Students', count: 842, percentage: 67 },
                { role: 'Teachers', count: 218, percentage: 18 },
                { role: 'Coordinators', count: 95, percentage: 8 },
                { role: 'Admins', count: 92, percentage: 7 },
              ].map((item, i) => (
                <div key={i}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium">{item.role}</span>
                    <span className="text-muted-foreground">{item.count} users</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary"
                      style={{ width: `${item.percentage}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          <Card className="p-6 bg-card/50">
            <h3 className="font-semibold mb-4">Recent Activity</h3>
            <div className="space-y-3 text-sm">
              {[
                { action: 'New course created', time: '5m ago' },
                { action: '12 new student registrations', time: '15m ago' },
                { action: 'System backup completed', time: '1h ago' },
                { action: 'Knowledge graph updated', time: '2h ago' },
              ].map((activity, i) => (
                <div key={i} className="p-3 rounded-xl bg-muted/30">
                  <div className="font-medium">{activity.action}</div>
                  <div className="text-muted-foreground text-xs">{activity.time}</div>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-6 bg-card/50">
            <h3 className="font-semibold mb-4">System Alerts</h3>
            <div className="space-y-3 text-sm">
              {[
                { message: 'Server maintenance scheduled', type: 'info' },
                { message: 'New feature available', type: 'success' },
                { message: 'Review pending reports', type: 'warning' },
              ].map((alert, i) => (
                <div key={i} className={`p-3 rounded-xl ${
                  alert.type === 'info' ? 'bg-primary/5 border border-primary/20' :
                  alert.type === 'success' ? 'bg-[#22C55E]/5 border border-[#22C55E]/20' :
                  'bg-[#F59E0B]/5 border border-[#F59E0B]/20'
                }`}>
                  {alert.message}
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-6 bg-card/50">
            <h3 className="font-semibold mb-4">Quick Actions</h3>
            <div className="space-y-2">
              <Button variant="outline" size="sm" className="w-full justify-start" onClick={() => setShowTeacherForm(true)}>
                <UserPlus className="w-4 h-4 mr-2" />
                Create Teacher Account
              </Button>
              <Button variant="outline" size="sm" className="w-full justify-start">
                <Users className="w-4 h-4 mr-2" />
                Manage Users
              </Button>
              <Button variant="outline" size="sm" className="w-full justify-start">
                <BookOpen className="w-4 h-4 mr-2" />
                View All Courses
              </Button>
              <Button variant="outline" size="sm" className="w-full justify-start">
                <TrendingUp className="w-4 h-4 mr-2" />
                Generate Reports
              </Button>
              <Button variant="outline" size="sm" className="w-full justify-start">
                <Settings className="w-4 h-4 mr-2" />
                System Settings
              </Button>
            </div>
          </Card>
        </div>
      </div>

      {/* Teacher Creation Modal */}
      {showTeacherForm && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-md p-6 bg-card">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold">Create Teacher Account</h2>
              <Button variant="ghost" size="icon" onClick={() => setShowTeacherForm(false)}>
                <Settings className="w-5 h-5" />
              </Button>
            </div>
            <form onSubmit={handleCreateTeacher} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="teacherName">Teacher Name</Label>
                <Input
                  id="teacherName"
                  type="text"
                  placeholder="John Smith"
                  value={teacherName}
                  onChange={(e) => setTeacherName(e.target.value)}
                  required
                  disabled={loading}
                  pattern="[a-zA-Z\s]+"
                  title="Name can only contain letters and spaces"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="teacherEmail">Teacher Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                  <Input
                    id="teacherEmail"
                    type="email"
                    placeholder="teacher@university.edu"
                    value={teacherEmail}
                    onChange={(e) => setTeacherEmail(e.target.value)}
                    className="pl-10"
                    required
                    disabled={loading}
                  />
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                The teacher will use this email to set up their password on the signup page.
              </p>
              <div className="flex gap-3 pt-4">
                <Button type="button" variant="outline" onClick={() => setShowTeacherForm(false)} disabled={loading} className="flex-1">
                  Cancel
                </Button>
                <Button type="submit" disabled={loading} className="flex-1">
                  {loading ? 'Creating...' : 'Create Teacher'}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
