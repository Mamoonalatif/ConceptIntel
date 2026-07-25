import React from 'react';

/**
 * Flat-vector "Teacher Access" illustration featuring a character teacher gesturing at a course management dashboard.
 */
export const TeacherAccessIllustration: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    viewBox="0 0 400 400"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    {/* Ground shadows */}
    <ellipse cx="110" cy="370" rx="70" ry="10" fill="rgb(var(--border))" opacity="0.4" />
    <ellipse cx="270" cy="370" rx="90" ry="12" fill="rgb(var(--border))" opacity="0.4" />

    {/* Character figure (Teacher) */}
    {/* Legs + shoes */}
    <rect x="94" y="284" width="15" height="80" rx="6" fill="rgb(var(--secondary))" />
    <rect x="118" y="284" width="15" height="80" rx="6" fill="rgb(var(--secondary))" />
    <ellipse cx="101" cy="364" rx="14" ry="6" fill="#374151" />
    <ellipse cx="125" cy="364" rx="14" ry="6" fill="#374151" />

    {/* Torso */}
    <rect x="86" y="196" width="56" height="92" rx="24" fill="#0d9488" />

    {/* Left lowered arm */}
    <line x1="90" y1="210" x2="74" y2="265" stroke="#e8b894" strokeWidth="13" strokeLinecap="round" />
    <circle cx="74" cy="265" r="8" fill="#e8b894" />

    {/* Right gesturing arm — points at course dashboard */}
    <line x1="138" y1="210" x2="190" y2="175" stroke="#e8b894" strokeWidth="13" strokeLinecap="round" />
    <circle cx="190" cy="175" r="8" fill="#e8b894" />

    {/* Head & Hair */}
    <rect x="105" y="180" width="18" height="18" fill="#e8b894" />
    <circle cx="114" cy="164" r="24" fill="#e8b894" />
    <path
      d="M90 160 Q90 134 114 134 Q138 134 138 160 L138 150 Q138 138 114 138 Q90 138 90 150 Z"
      fill="#4a3b32"
    />

    {/* Teacher dashboard panel */}
    <rect x="190" y="80" width="180" height="230" rx="20" fill="rgb(var(--surface))" stroke="rgb(var(--border))" strokeWidth="3" />

    {/* Header bar */}
    <rect x="190" y="80" width="180" height="38" rx="20" fill="rgb(var(--primary-muted))" />
    <circle cx="212" cy="99" r="5" fill="#0d9488" />
    <circle cx="228" cy="99" r="5" fill="#3b82f6" />
    <circle cx="244" cy="99" r="5" fill="#6366f1" />

    {/* Course card 1 */}
    <rect x="210" y="132" width="140" height="52" rx="8" fill="rgb(var(--background))" stroke="rgb(var(--border))" strokeWidth="1.5" />
    <rect x="222" y="145" width="40" height="8" rx="4" fill="#0d9488" />
    <rect x="222" y="160" width="70" height="6" rx="3" fill="rgb(var(--border))" />

    {/* Course card 2 */}
    <rect x="210" y="196" width="140" height="52" rx="8" fill="rgb(var(--background))" stroke="rgb(var(--border))" strokeWidth="1.5" />
    <rect x="222" y="209" width="40" height="8" rx="4" fill="#6366f1" />
    <rect x="222" y="224" width="70" height="6" rx="3" fill="rgb(var(--border))" />

    {/* Verified teacher seal */}
    <g style={{ animation: 'ci-float 5.5s ease-in-out infinite' }}>
      <circle cx="345" cy="115" r="22" fill="#0d9488" />
      <path d="M337 115 L342 120 L353 109" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </g>
  </svg>
);
