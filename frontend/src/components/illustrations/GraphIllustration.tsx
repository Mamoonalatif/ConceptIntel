import React from 'react';
import FoxMascot from '../FoxMascot';

export const GraphIllustration: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`relative flex flex-col items-center justify-center py-4 ${className}`}>
    <div className="absolute top-2 left-4 animate-[bounce_4s_infinite] bg-white/95 dark:bg-slate-800/95 backdrop-blur-md rounded-2xl px-3.5 py-2 shadow-lg border border-white/40 flex items-center gap-2">
      <span className="text-xl">🕸️</span>
      <span className="text-xs font-black text-teal-500">Knowledge Graph</span>
    </div>
    <FoxMascot pose="excited" role="student" size={210} animated={true} />
  </div>
);

export default GraphIllustration;
