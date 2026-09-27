import React from 'react';
import FoxMascot from '../FoxMascot';

export const TeacherAccessIllustration: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`relative flex flex-col items-center justify-center py-4 ${className}`}>
    <div className="absolute top-2 right-4 animate-[wiggle_3s_ease-in-out_infinite] bg-white/95 dark:bg-slate-800/95 backdrop-blur-md rounded-2xl px-3.5 py-2 shadow-lg border border-white/40 flex items-center gap-2">
      <span className="text-xl">🔑</span>
      <span className="text-xs font-black text-emerald-500">Teacher Portal</span>
    </div>
    <FoxMascot pose="focused" role="teacher" size={200} animated={true} />
  </div>
);

export default TeacherAccessIllustration;
