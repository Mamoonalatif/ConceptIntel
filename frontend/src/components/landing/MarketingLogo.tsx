import React from 'react';
import { ConceptIntelLogo as SharedConceptIntelLogo } from '../ConceptIntelLogo';

/**
 * ConceptIntel logo mark wrapper for marketing header and footers.
 * Uses the clean Fox logo mark.
 */
export const MarketingLogo: React.FC<{ size?: number }> = ({ size = 40 }) => (
  <SharedConceptIntelLogo size={size} />
);

export default MarketingLogo;

