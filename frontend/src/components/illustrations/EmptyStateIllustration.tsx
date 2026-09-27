import React from 'react';
import FoxMascot from '../FoxMascot';

export const EmptyStateIllustration: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`flex flex-col items-center justify-center p-4 text-center ${className}`}>
    <FoxMascot pose="supportive" role="student" size={150} animated={true} />
  </div>
);

export default EmptyStateIllustration;
