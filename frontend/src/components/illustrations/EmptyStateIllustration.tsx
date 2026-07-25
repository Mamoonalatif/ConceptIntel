import React from 'react';

/**
 * Flat-vector "empty state" illustration — a small, simplified faceless
 * character shrugging at a blank clipboard. Deliberately lower-detail than
 * `StudyIllustration`/`TeachIllustration` so it stays legible at the small
 * sizes dashboards render empty states at (~120-160px).
 *
 * Theme-aware: skin/hair are fixed neutral tones, clothing/clipboard/lines
 * use the app's CSS variable palette so it adapts automatically between
 * light/dark mode.
 *
 * Used inside dashboard empty-list states (e.g. "no classes joined yet",
 * "no assignments yet").
 */
export const EmptyStateIllustration: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    viewBox="0 0 300 300"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    {/* ground shadow */}
    <ellipse cx="150" cy="280" rx="105" ry="8" fill="rgb(var(--border))" opacity="0.4" />

    {/* blank clipboard */}
    <rect x="150" y="72" width="92" height="128" rx="10" fill="rgb(var(--surface))" stroke="rgb(var(--border))" strokeWidth="3" />
    <rect x="180" y="62" width="32" height="16" rx="6" fill="rgb(var(--secondary-light))" />
    <line x1="165" y1="112" x2="227" y2="112" stroke="rgb(var(--border))" strokeWidth="5" strokeLinecap="round" />
    <line x1="165" y1="134" x2="227" y2="134" stroke="rgb(var(--border))" strokeWidth="5" strokeLinecap="round" />
    <line x1="165" y1="156" x2="205" y2="156" stroke="rgb(var(--border))" strokeWidth="5" strokeLinecap="round" />

    {/* legs + shoes */}
    <rect x="90" y="222" width="15" height="52" rx="6" fill="rgb(var(--secondary))" />
    <rect x="113" y="222" width="15" height="52" rx="6" fill="rgb(var(--secondary))" />
    <ellipse cx="97" cy="276" rx="12" ry="5" fill="#374151" />
    <ellipse cx="121" cy="276" rx="12" ry="5" fill="#374151" />

    {/* torso / clothing */}
    <rect x="82" y="152" width="60" height="78" rx="24" fill="rgb(var(--primary))" />

    {/* shrugging arms */}
    <line x1="86" y1="167" x2="58" y2="146" stroke="#e8b894" strokeWidth="12" strokeLinecap="round" />
    <line x1="138" y1="167" x2="166" y2="146" stroke="#e8b894" strokeWidth="12" strokeLinecap="round" />
    <circle cx="58" cy="146" r="8" fill="#e8b894" />
    <circle cx="166" cy="146" r="8" fill="#e8b894" />

    {/* neck + head */}
    <rect x="102" y="138" width="19" height="16" fill="#e8b894" />
    <circle cx="112" cy="124" r="23" fill="#e8b894" />

    {/* simple hair cap */}
    <path
      d="M89 120 Q89 96 112 96 Q135 96 135 120 L135 111 Q135 101 112 101 Q89 101 89 111 Z"
      fill="#3a2e2a"
    />
  </svg>
);

export default EmptyStateIllustration;
