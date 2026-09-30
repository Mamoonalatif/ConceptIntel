// Purpose: reusable loading indicator (bouncing fox mascot with an optional label).
import React from 'react';
import { FoxMascot } from './FoxMascot';

// Props: extra CSS classes, the caption under the fox, and the mascot size in px.
interface FoxSpinnerProps {
  className?: string;
  label?: string;
  size?: number;
}

/**
 * ConceptIntel Loading Spinner — Uses the exact same Fox Mascot character
 * with a smooth bouncing motion and 100% solid, non-fading visibility.
 */
export const FoxSpinner: React.FC<FoxSpinnerProps> = ({
  className = '',
  label = 'Loading...',
  size = 64,
}) => (
  <div className={`flex flex-col items-center justify-center space-y-3 select-none ${className}`}>
    <div className="relative flex items-center justify-center animate-bounce">
      <FoxMascot size={size} animated={false} pose="happy" />
    </div>
    {label && (
      <p className="text-sm text-text-secondary font-medium">
        {label}
      </p>
    )}
  </div>
);

export default FoxSpinner;
