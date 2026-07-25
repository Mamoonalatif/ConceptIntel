import React from 'react';
import { ConceptIntelLogo as SharedConceptIntelLogo } from '../ConceptIntelLogo';

/**
 * ConceptIntel logo mark, restyled to the landing/about pages' energetic
 * marketing palette (teal → amber). Wraps the single shared `ConceptIntelLogo`
 * component (same mark used on Login/Register/RequestTeacherAccess) so the
 * artwork itself isn't duplicated — only the gradient colors passed to it
 * differ here. Shared by LandingPage, AboutPage, Nav and Footer so the
 * marketing treatment stays in one place.
 */
export const MarketingLogo: React.FC<{ size?: number }> = ({ size = 40 }) => (
  <SharedConceptIntelLogo
    size={size}
    badgeGradient={['#0f766e', '#14b8a6']}
    dotGradient={['#f59e0b', '#fb923c']}
  />
);

export default MarketingLogo;
