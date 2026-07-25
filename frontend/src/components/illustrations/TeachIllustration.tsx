import React from 'react';

/**
 * Flat-vector "teach" illustration — a standing, faceless character gesturing
 * toward a floating knowledge-graph node panel (echoing the ConceptIntel
 * brand mark used in `ConceptIntelLogo`/`HeroVisual` on the landing page:
 * a center node connected to four satellite nodes).
 *
 * Theme-aware: skin/hair use fixed neutral tones, clothing/panel/border use
 * the app's CSS variable palette. Satellite nodes use a couple of fixed
 * accent hues (amber/rose) alongside the theme-aware teal tokens, matching
 * the landing page's richer marketing palette.
 *
 * Used on: landing page hero / teacher-facing empty states.
 */
export const TeachIllustration: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    viewBox="0 0 400 400"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    {/* ground shadow */}
    <ellipse cx="150" cy="372" rx="95" ry="11" fill="rgb(var(--border))" opacity="0.4" />

    {/* legs + shoes */}
    <rect x="130" y="288" width="17" height="76" rx="7" fill="rgb(var(--secondary))" />
    <rect x="159" y="288" width="17" height="76" rx="7" fill="rgb(var(--secondary))" />
    <ellipse cx="138" cy="366" rx="15" ry="6" fill="#374151" />
    <ellipse cx="167" cy="366" rx="15" ry="6" fill="#374151" />

    {/* torso / clothing */}
    <rect x="119" y="200" width="66" height="96" rx="27" fill="rgb(var(--primary))" />

    {/* lowered arm */}
    <line x1="126" y1="216" x2="109" y2="270" stroke="#e8b894" strokeWidth="14" strokeLinecap="round" />
    <circle cx="109" cy="270" r="9" fill="#e8b894" />

    {/* raised, gesturing arm — points at the graph panel */}
    <line x1="179" y1="216" x2="233" y2="172" stroke="#e8b894" strokeWidth="14" strokeLinecap="round" />
    <circle cx="233" cy="172" r="9" fill="#e8b894" />

    {/* neck + head */}
    <rect x="142" y="184" width="21" height="19" fill="#e8b894" />
    <circle cx="152" cy="168" r="27" fill="#e8b894" />

    {/* simple hair cap */}
    <path
      d="M125 164 Q125 136 152 136 Q179 136 179 164 L179 154 Q179 142 152 142 Q125 142 125 154 Z"
      fill="#3a2e2a"
    />

    {/* floating knowledge-graph panel */}
    <rect x="228" y="66" width="152" height="152" rx="18" fill="rgb(var(--surface))" stroke="rgb(var(--border))" strokeWidth="2" />

    {/* connecting edges (drawn first, under the nodes) */}
    <line x1="304" y1="142" x2="269" y2="107" stroke="rgb(var(--border))" strokeWidth="3" />
    <line x1="304" y1="142" x2="339" y2="107" stroke="rgb(var(--border))" strokeWidth="3" />
    <line x1="304" y1="142" x2="269" y2="177" stroke="rgb(var(--border))" strokeWidth="3" />
    <line x1="304" y1="142" x2="339" y2="177" stroke="rgb(var(--border))" strokeWidth="3" />

    {/* satellite concept nodes */}
    <circle cx="269" cy="107" r="11" fill="#f59e0b" />
    <circle cx="339" cy="107" r="11" fill="#fb7185" />
    <circle cx="269" cy="177" r="11" fill="rgb(var(--primary-light))" />
    <circle cx="339" cy="177" r="11" fill="rgb(var(--secondary-light))" />

    {/* center node */}
    <circle cx="304" cy="142" r="15" fill="rgb(var(--primary))" />
  </svg>
);

export default TeachIllustration;
