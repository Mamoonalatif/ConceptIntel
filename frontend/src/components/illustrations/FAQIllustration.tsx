import React from 'react';
import FoxMascot from '../FoxMascot';

export const FAQIllustration: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`flex flex-col items-center justify-center space-y-3 py-2 ${className}`}>
    <FoxMascot pose="thinking" role="default" size={210} animated={true} />
    <div className="bg-surface/95 backdrop-blur-md rounded-2xl px-4 py-2 shadow-sm border border-border flex items-center gap-2">
      <span className="text-lg">💡</span>
      <span className="text-xs font-bold text-primary">ConceptIntel Answers</span>
    </div>
  </div>
);

export default FAQIllustration;
