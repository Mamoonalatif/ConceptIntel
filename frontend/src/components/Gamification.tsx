import React, { useEffect, useState } from 'react';
import { Trophy, Flame, Award, Medal } from 'lucide-react';
import { gamificationService } from '../services/api';
import type { LeaderboardEntry, MyGamificationSummary, BadgeItem } from '../services/api';
import { useAuth } from '../context/AuthContext';

import { FoxMascot } from './FoxMascot';

interface GamificationProps {
  courseId: number;
  isTeacher: boolean;
}

const RANK_COLORS = ['text-amber-500', 'text-slate-400', 'text-orange-600'];

export const Gamification: React.FC<GamificationProps> = ({ courseId, isTeacher }) => {
  const { user } = useAuth();
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [summary, setSummary] = useState<MyGamificationSummary | null>(null);
  const [allBadges, setAllBadges] = useState<BadgeItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    Promise.all([
      gamificationService.getLeaderboard(courseId),
      isTeacher ? Promise.resolve(null) : gamificationService.getMySummary(courseId),
      gamificationService.listAllBadges(),
    ])
      .then(([lb, mySummary, badges]) => {
        if (!mounted) return;
        setLeaderboard(lb);
        setSummary(mySummary);
        setAllBadges(badges);
      })
      .catch(() => {})
      .finally(() => mounted && setLoading(false));
    return () => { mounted = false; };
  }, [courseId, isTeacher]);

  if (loading) {
    return (
      <div className="bg-surface rounded-2xl p-6 border border-border animate-fade-up">
        <div className="text-center py-8 text-sm text-text-muted">Loading...</div>
      </div>
    );
  }

  const earnedCodes = new Set((summary?.badges || []).map((b) => b.code));

  return (
    <div className="bg-surface rounded-2xl p-6 border border-border animate-fade-up space-y-5 relative overflow-hidden">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-bold text-text-primary flex items-center gap-2">
          <Trophy className="w-4.5 h-4.5 text-secondary" />
          Academic Leaderboard & Achievements
        </h3>
        <FoxMascot pose={summary && summary.current_streak_days > 0 ? 'celebrating' : 'cheering'} size={65} animated={true} />
      </div>

      {!isTeacher && summary && (
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-background rounded-xl p-3 flex items-center gap-2.5">
            <div className="w-9 h-9 bg-primary-muted rounded-xl flex items-center justify-center shrink-0">
              <Medal className="w-4.5 h-4.5 text-primary" />
            </div>
            <div>
              <p className="text-[11px] text-text-muted">Your Points</p>
              <p className="text-lg font-bold text-text-primary">{summary.total_points}</p>
            </div>
          </div>
          <div className="bg-background rounded-xl p-3 flex items-center gap-2.5">
            <div className="w-9 h-9 bg-amber-50 dark:bg-amber-500/10 rounded-xl flex items-center justify-center shrink-0">
              <Flame className="w-4.5 h-4.5 text-amber-500" />
            </div>
            <div>
              <p className="text-[11px] text-text-muted">Day Streak</p>
              <p className="text-lg font-bold text-text-primary">{summary.current_streak_days}</p>
            </div>
          </div>
        </div>
      )}

      <div>
        <h4 className="text-xs font-bold text-text-secondary uppercase tracking-wide mb-2 flex items-center gap-1.5">
          <Award className="w-3.5 h-3.5" /> Badges
        </h4>
        <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
          {allBadges.map((b) => {
            const earned = isTeacher || earnedCodes.has(b.code);
            return (
              <div
                key={b.code}
                title={`${b.name}: ${b.description} (+${b.points_reward} pts)`}
                className={`aspect-square rounded-xl flex flex-col items-center justify-center text-center p-1 border ${
                  earned ? 'bg-primary-muted border-primary/20' : 'bg-background border-border opacity-35'
                }`}
              >
                <span className="text-lg leading-none">{b.icon}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <h4 className="text-xs font-bold text-text-secondary uppercase tracking-wide mb-2">Leaderboard</h4>
        {leaderboard.length === 0 ? (
          <p className="text-xs text-text-muted">No points earned yet — complete a quiz or assignment to get on the board.</p>
        ) : (
          <div className="space-y-1.5">
            {leaderboard.map((entry) => (
              <div
                key={entry.student_id}
                className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2 ${
                  entry.student_id === user?.id ? 'bg-primary-muted border border-primary/20' : 'bg-background'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`text-xs font-bold w-5 shrink-0 ${RANK_COLORS[entry.rank - 1] || 'text-text-muted'}`}>
                    #{entry.rank}
                  </span>
                  <span className="text-xs font-semibold text-text-primary truncate">{entry.student_name}</span>
                  {entry.current_streak_days >= 3 && (
                    <span className="flex items-center gap-0.5 text-[11px] text-amber-500 shrink-0">
                      <Flame className="w-3 h-3" /> {entry.current_streak_days}
                    </span>
                  )}
                </div>
                <span className="text-xs font-bold text-secondary shrink-0">{entry.total_points} pts</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
