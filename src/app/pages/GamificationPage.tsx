import { motion } from 'motion/react';
import { Link } from 'react-router';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Progress } from '../components/ui/progress';
import { ArrowLeft, Trophy, Award, Flame, Target, Star, Zap, Crown } from 'lucide-react';

const badges = [
  { name: 'First Steps', desc: 'Complete your first lesson', icon: Star, unlocked: true, color: 'from-yellow-500 to-orange-500' },
  { name: 'Quick Learner', desc: 'Achieve 90% on 5 quizzes', icon: Zap, unlocked: true, color: 'from-purple-500 to-pink-500' },
  { name: 'Graph Master', desc: 'Master all graph concepts', icon: Trophy, unlocked: true, color: 'from-blue-500 to-cyan-500' },
  { name: 'Consistency King', desc: '30-day learning streak', icon: Flame, unlocked: false, color: 'from-orange-500 to-red-500' },
  { name: 'Problem Solver', desc: 'Solve 100 problems', icon: Target, unlocked: false, color: 'from-green-500 to-teal-500' },
  { name: 'Elite Scholar', desc: 'Reach Level 50', icon: Crown, unlocked: false, color: 'from-purple-600 to-pink-600' },
];

const leaderboard = [
  { rank: 1, name: 'Sarah Johnson', xp: 8420, avatar: 'SJ' },
  { rank: 2, name: 'Michael Chen', xp: 7850, avatar: 'MC' },
  { rank: 3, name: 'Emma Davis', xp: 7240, avatar: 'ED' },
  { rank: 4, name: 'You', xp: 6890, avatar: 'JD', isUser: true },
  { rank: 5, name: 'Alex Thompson', xp: 6520, avatar: 'AT' },
];

export function GamificationPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border bg-card/50 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-6 py-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" asChild>
              <Link to="/student/dashboard">
                <ArrowLeft className="w-5 h-5" />
              </Link>
            </Button>
            <div>
              <h1 className="text-xl font-bold">Your Achievements</h1>
              <p className="text-sm text-muted-foreground">Track your progress and compete</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        {/* XP & Level Card */}
        <Card className="p-8 bg-gradient-to-br from-primary/20 via-transparent to-secondary/20 border-primary/30 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-secondary/5" />
          
          <div className="relative grid md:grid-cols-3 gap-8">
            <div className="text-center">
              <div className="w-24 h-24 mx-auto mb-4 rounded-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center relative">
                <span className="text-4xl font-bold text-white">32</span>
                <div className="absolute inset-0 rounded-full bg-gradient-to-br from-primary to-secondary blur-xl opacity-50" />
              </div>
              <div className="text-sm text-muted-foreground mb-1">Your Level</div>
              <div className="text-2xl font-bold">Level 32</div>
            </div>

            <div className="text-center">
              <div className="text-5xl font-bold bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent mb-2">
                6,890
              </div>
              <div className="text-sm text-muted-foreground mb-4">Total XP</div>
              <div className="max-w-xs mx-auto">
                <div className="flex items-center justify-between text-xs mb-2">
                  <span>Level 32</span>
                  <span>Level 33</span>
                </div>
                <Progress value={68} className="h-3" />
                <div className="text-xs text-muted-foreground mt-1">320 XP to next level</div>
              </div>
            </div>

            <div className="text-center">
              <div className="flex items-center justify-center gap-2 mb-4">
                <Flame className="w-12 h-12 text-orange-500" />
                <div className="text-5xl font-bold text-orange-500">12</div>
              </div>
              <div className="text-sm text-muted-foreground mb-1">Learning Streak</div>
              <div className="text-lg font-semibold">Keep it up!</div>
            </div>
          </div>
        </Card>

        {/* Badges */}
        <div>
          <h2 className="text-2xl font-bold mb-6">Badges & Achievements</h2>
          <div className="grid md:grid-cols-3 gap-6">
            {badges.map((badge, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.1 }}
              >
                <Card className={`p-6 ${badge.unlocked ? 'bg-card/50' : 'opacity-50'} hover:shadow-lg transition-all`}>
                  <div className={`w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br ${badge.color} flex items-center justify-center relative`}>
                    <badge.icon className="w-8 h-8 text-white" />
                    {!badge.unlocked && (
                      <div className="absolute inset-0 bg-black/40 rounded-2xl flex items-center justify-center backdrop-blur-sm">
                        <div className="text-2xl">🔒</div>
                      </div>
                    )}
                  </div>
                  <h3 className="font-semibold text-center mb-2">{badge.name}</h3>
                  <p className="text-sm text-muted-foreground text-center">{badge.desc}</p>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>

        <div className="grid lg:grid-cols-2 gap-8">
          {/* Leaderboard */}
          <Card className="p-6 bg-card/50">
            <div className="flex items-center gap-2 mb-6">
              <Trophy className="w-6 h-6 text-yellow-500" />
              <h2 className="text-2xl font-bold">Leaderboard</h2>
            </div>
            
            <div className="space-y-3">
              {leaderboard.map((user) => (
                <div
                  key={user.rank}
                  className={`p-4 rounded-xl flex items-center gap-4 ${
                    user.isUser ? 'bg-primary/10 border border-primary/20' : 'bg-muted/30'
                  }`}
                >
                  <div className="flex items-center gap-3 flex-1">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold ${
                      user.rank === 1 ? 'bg-yellow-500 text-white' :
                      user.rank === 2 ? 'bg-gray-400 text-white' :
                      user.rank === 3 ? 'bg-orange-600 text-white' :
                      'bg-muted text-muted-foreground'
                    }`}>
                      {user.rank}
                    </div>
                    
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center text-white font-medium">
                      {user.avatar}
                    </div>
                    
                    <div className="flex-1">
                      <div className="font-semibold">{user.name}</div>
                      <div className="text-sm text-muted-foreground">{user.xp.toLocaleString()} XP</div>
                    </div>
                  </div>

                  {user.rank <= 3 && (
                    <Trophy className={`w-6 h-6 ${
                      user.rank === 1 ? 'text-yellow-500' :
                      user.rank === 2 ? 'text-gray-400' :
                      'text-orange-600'
                    }`} />
                  )}
                </div>
              ))}
            </div>
          </Card>

          {/* Daily Challenges */}
          <Card className="p-6 bg-card/50">
            <div className="flex items-center gap-2 mb-6">
              <Target className="w-6 h-6 text-secondary" />
              <h2 className="text-2xl font-bold">Daily Challenges</h2>
            </div>
            
            <div className="space-y-4">
              {[
                { task: 'Complete 3 practice problems', progress: 2, total: 3, xp: 50 },
                { task: 'Review 5 weak concepts', progress: 5, total: 5, xp: 100, completed: true },
                { task: 'Watch 2 video lectures', progress: 1, total: 2, xp: 75 },
                { task: 'Maintain your streak', progress: 1, total: 1, xp: 25, completed: true },
              ].map((challenge, i) => (
                <div key={i} className={`p-4 rounded-xl ${challenge.completed ? 'bg-[#22C55E]/10 border border-[#22C55E]/20' : 'bg-muted/30'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium">{challenge.task}</span>
                    <span className="text-sm px-2 py-1 rounded-full bg-primary/10 text-primary">
                      +{challenge.xp} XP
                    </span>
                  </div>
                  {!challenge.completed ? (
                    <div className="flex items-center gap-3">
                      <Progress value={(challenge.progress / challenge.total) * 100} className="flex-1" />
                      <span className="text-sm text-muted-foreground">{challenge.progress}/{challenge.total}</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-[#22C55E] text-sm">
                      <Award className="w-4 h-4" />
                      <span>Completed!</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Recent Achievements */}
        <Card className="p-6 bg-card/50">
          <h2 className="text-2xl font-bold mb-6">Recent Achievements</h2>
          <div className="grid md:grid-cols-4 gap-4">
            {[
              { title: 'Quiz Master', date: '2 days ago', xp: 250 },
              { title: 'Fast Learner', date: '5 days ago', xp: 150 },
              { title: 'Concept Champion', date: '1 week ago', xp: 300 },
              { title: 'Problem Solver', date: '2 weeks ago', xp: 200 },
            ].map((achievement, i) => (
              <div key={i} className="p-4 rounded-xl bg-muted/30 text-center">
                <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center">
                  <Award className="w-6 h-6 text-white" />
                </div>
                <h4 className="font-semibold mb-1">{achievement.title}</h4>
                <div className="text-xs text-muted-foreground mb-2">{achievement.date}</div>
                <div className="text-sm text-primary font-medium">+{achievement.xp} XP</div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
