import React from 'react';

/**
 * Flat-vector "Knowledge Graph" illustration featuring a character figure gesturing at an interactive graph network.
 */
export const GraphIllustration: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    viewBox="0 0 400 400"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    {/* Ground shadows */}
    <ellipse cx="110" cy="370" rx="70" ry="10" fill="rgb(var(--border))" opacity="0.4" />
    <ellipse cx="270" cy="370" rx="90" ry="12" fill="rgb(var(--border))" opacity="0.4" />

    {/* Character figure */}
    {/* Legs + shoes */}
    <rect x="94" y="284" width="15" height="80" rx="6" fill="rgb(var(--secondary))" />
    <rect x="118" y="284" width="15" height="80" rx="6" fill="rgb(var(--secondary))" />
    <ellipse cx="101" cy="364" rx="14" ry="6" fill="#374151" />
    <ellipse cx="125" cy="364" rx="14" ry="6" fill="#374151" />

    {/* Torso */}
    <rect x="86" y="196" width="56" height="92" rx="24" fill="#0d9488" />

    {/* Left arm */}
    <line x1="90" y1="210" x2="74" y2="265" stroke="#e8b894" strokeWidth="13" strokeLinecap="round" />
    <circle cx="74" cy="265" r="8" fill="#e8b894" />

    {/* Right gesturing arm — pointing at core graph node */}
    <line x1="138" y1="210" x2="190" y2="160" stroke="#e8b894" strokeWidth="13" strokeLinecap="round" />
    <circle cx="190" cy="160" r="8" fill="#e8b894" />

    {/* Head & Hair */}
    <rect x="105" y="180" width="18" height="18" fill="#e8b894" />
    <circle cx="114" cy="164" r="24" fill="#e8b894" />
    <path
      d="M90 160 Q90 134 114 134 Q138 134 138 160 L138 150 Q138 138 114 138 Q90 138 90 150 Z"
      fill="#374151"
    />

    {/* Backdrop Graph Frame */}
    <rect x="180" y="80" width="200" height="230" rx="20" fill="rgb(var(--surface))" stroke="rgb(var(--border))" strokeWidth="3" />

    {/* Interconnected Graph Edges */}
    <line x1="280" y1="135" x2="230" y2="195" stroke="rgb(var(--primary))" strokeWidth="2.5" strokeDasharray="3 3" />
    <line x1="280" y1="135" x2="330" y2="195" stroke="rgb(var(--primary))" strokeWidth="2.5" />
    <line x1="230" y1="195" x2="265" y2="250" stroke="rgb(var(--primary))" strokeWidth="2.5" />
    <line x1="330" y1="195" x2="295" y2="250" stroke="rgb(var(--primary))" strokeWidth="2.5" />
    <line x1="265" y1="250" x2="295" y2="250" stroke="#0d9488" strokeWidth="3" />

    {/* Central Core Concept Node */}
    <g style={{ animation: 'ci-float 5s ease-in-out infinite' }}>
      <circle cx="280" cy="135" r="22" fill="rgb(var(--primary))" />
      <circle cx="280" cy="135" r="9" fill="white" />
    </g>

    {/* Left Prerequisite Node */}
    <circle cx="230" cy="195" r="16" fill="#0d9488" />
    <circle cx="230" cy="195" r="6" fill="white" />

    {/* Right Concept Node */}
    <circle cx="330" cy="195" r="16" fill="#6366f1" />
    <circle cx="330" cy="195" r="6" fill="white" />

    {/* Bottom Linked Nodes */}
    <circle cx="265" cy="250" r="13" fill="#f59e0b" />
    <circle cx="295" cy="250" r="13" fill="#10b981" />

    {/* Mastery stat callout */}
    <g style={{ animation: 'ci-float 6s ease-in-out infinite', animationDelay: '1s' }}>
      <rect x="310" y="90" width="65" height="34" rx="8" fill="rgb(var(--background))" stroke="rgb(var(--border))" strokeWidth="1.5" />
      <text x="318" y="104" fill="rgb(var(--text-muted))" fontSize="8" fontWeight="bold">MASTERY</text>
      <text x="318" y="117" fill="#0d9488" fontSize="11" fontWeight="extrabold">94%</text>
    </g>
  </svg>
);
