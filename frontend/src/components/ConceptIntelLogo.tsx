import React from 'react';
import { FoxMark } from './FoxMark';

export interface ConceptIntelLogoProps {
  size?: number;
  className?: string;
  badgeGradient?: [string, string];
  dotGradient?: [string, string];
}

export const ConceptIntelLogo: React.FC<ConceptIntelLogoProps> = ({
  size = 40,
  className = '',
}) => {
  return (
    <FoxMark className={className || `w-[${size}px] h-[${size}px]`} variant="bare" tone="brand" />
  );
};

export default ConceptIntelLogo;
