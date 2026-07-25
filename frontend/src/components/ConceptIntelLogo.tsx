import React, { useRef } from 'react';

let logoInstanceCount = 0;

export interface ConceptIntelLogoProps {
  size?: number;
  className?: string;
  /**
   * Optional two-stop gradient for the badge background. When omitted the
   * badge renders as a flat `rgb(var(--primary))` fill, so the mark tracks
   * the app's current theme color (and dark mode) automatically.
   */
  badgeGradient?: [string, string];
  /**
   * Optional two-stop gradient for the center dot. When omitted the dot
   * renders with the same flat fill as the badge.
   */
  dotGradient?: [string, string];
}

/**
 * The single ConceptIntel brand mark — a small rounded-square badge with a
 * concept-map "node graph" glyph (four outer nodes + a center node, joined by
 * short connector lines). This is the one shared implementation of that mark;
 * every place in the app that shows the ConceptIntel logo should render this
 * component rather than re-declaring the SVG inline.
 *
 * By default both the badge and the center dot use `rgb(var(--primary))` so
 * the mark automatically matches the app's theme colors in light and dark
 * mode. Callers that want a richer marketing treatment (e.g. the landing
 * page's teal → amber gradient) can pass `badgeGradient`/`dotGradient`
 * without duplicating the underlying artwork.
 */
export const ConceptIntelLogo: React.FC<ConceptIntelLogoProps> = ({
  size = 40,
  className,
  badgeGradient,
  dotGradient,
}) => {
  const idRef = useRef(`ci-logo-${logoInstanceCount++}`);
  const badgeGradId = `${idRef.current}-badge`;
  const dotGradId = `${idRef.current}-dot`;

  const badgeFill = badgeGradient ? `url(#${badgeGradId})` : 'rgb(var(--primary))';
  const dotFill = dotGradient ? `url(#${dotGradId})` : 'rgb(var(--primary))';

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {(badgeGradient || dotGradient) && (
        <defs>
          {badgeGradient && (
            <linearGradient id={badgeGradId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={badgeGradient[0]} />
              <stop offset="100%" stopColor={badgeGradient[1]} />
            </linearGradient>
          )}
          {dotGradient && (
            <linearGradient id={dotGradId} x1="0%" y1="100%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={dotGradient[0]} />
              <stop offset="100%" stopColor={dotGradient[1]} />
            </linearGradient>
          )}
        </defs>
      )}
      <rect width="40" height="40" rx="10" fill={badgeFill} />
      <circle cx="12" cy="20" r="3.5" fill="white" opacity="0.95" />
      <circle cx="20" cy="12" r="3.5" fill="white" opacity="0.95" />
      <circle cx="20" cy="28" r="3.5" fill="white" opacity="0.95" />
      <circle cx="28" cy="20" r="3.5" fill="white" opacity="0.95" />
      <circle cx="20" cy="20" r="4.5" fill="white" />
      <line x1="12" y1="20" x2="15.5" y2="20" stroke="white" strokeWidth="1.5" strokeOpacity="0.6" />
      <line x1="20" y1="12" x2="20" y2="15.5" stroke="white" strokeWidth="1.5" strokeOpacity="0.6" />
      <line x1="20" y1="24.5" x2="20" y2="28" stroke="white" strokeWidth="1.5" strokeOpacity="0.6" />
      <line x1="24.5" y1="20" x2="28" y2="20" stroke="white" strokeWidth="1.5" strokeOpacity="0.6" />
      <circle cx="20" cy="20" r="2" fill={dotFill} />
    </svg>
  );
};

export default ConceptIntelLogo;
