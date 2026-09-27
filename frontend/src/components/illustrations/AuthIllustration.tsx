import React from 'react';
import FoxMascot from '../FoxMascot';

export const AuthIllustration: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`relative flex flex-col items-center justify-center py-4 ${className}`}>
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
      <div className="w-56 h-56 bg-primary/10 rounded-full blur-2xl" />
    </div>

    <div className="absolute top-2 left-4 animate-[wiggle_4s_ease-in-out_infinite] bg-white/95 dark:bg-slate-800/95 backdrop-blur-md rounded-2xl px-3.5 py-2 shadow-lg border border-white/40 flex items-center gap-2">
      <span className="text-xl">✨</span>
      <span className="text-xs font-black text-amber-500">Smarter Learning Together</span>
    </div>

    <div className="absolute bottom-6 right-4 animate-[bounce_3s_infinite] bg-white/95 dark:bg-slate-800/95 backdrop-blur-md rounded-2xl px-3.5 py-2 shadow-lg border border-white/40 flex items-center gap-2">
      <span className="text-xl">🎓</span>
      <span className="text-xs font-black text-indigo-500">Your Goals Matter</span>
    </div>

    <FoxMascot pose="happy" role="student" size={210} animated={true} />
  </div>
);

export default AuthIllustration;
