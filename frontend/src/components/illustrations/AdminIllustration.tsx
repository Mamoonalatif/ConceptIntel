import React from 'react';

/**
 * Flat-vector "admin" illustration — a standing figure in formal clothing
 * gesturing at a multi-panel analytics dashboard with user management and
 * system status tiles. Matches the character visual language of
 * TeachIllustration / StudyIllustration.
 *
 * Used on: landing page roles section (Admin card).
 */
export const AdminIllustration: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    viewBox="0 0 400 400"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    {/* ground shadow */}
    <ellipse cx="138" cy="374" rx="80" ry="10" fill="rgb(var(--border))" opacity="0.4" />

    {/* legs + shoes */}
    <rect x="118" y="290" width="16" height="78" rx="7" fill="#334155" />
    <rect x="148" y="290" width="16" height="78" rx="7" fill="#334155" />
    <ellipse cx="126" cy="368" rx="14" ry="6" fill="#1e293b" />
    <ellipse cx="156" cy="368" rx="14" ry="6" fill="#1e293b" />

    {/* torso - formal blazer */}
    <rect x="108" y="202" width="66" height="94" rx="27" fill="#475569" />
    {/* lapels */}
    <path d="M141 202 L129 230 L141 222 Z" fill="#64748b" />
    <path d="M141 202 L153 230 L141 222 Z" fill="#64748b" />

    {/* left arm gesturing at dashboard */}
    <line x1="174" y1="220" x2="225" y2="185" stroke="#e8b894" strokeWidth="13" strokeLinecap="round" />
    <circle cx="225" cy="185" r="8" fill="#e8b894" />

    {/* right arm down */}
    <line x1="108" y1="220" x2="94" y2="272" stroke="#e8b894" strokeWidth="13" strokeLinecap="round" />
    <circle cx="94" cy="272" r="8" fill="#e8b894" />

    {/* neck + head */}
    <rect x="133" y="183" width="18" height="20" fill="#e8b894" />
    <circle cx="142" cy="167" r="26" fill="#e8b894" />

    {/* hair */}
    <path
      d="M116 163 Q116 136 142 136 Q168 136 168 163 L168 152 Q168 140 142 140 Q116 140 116 152 Z"
      fill="#1e293b"
    />

    {/* Admin dashboard panel */}
    <rect x="215" y="72" width="175" height="220" rx="20" fill="rgb(var(--surface))" stroke="rgb(var(--border))" strokeWidth="2.5" />

    {/* Header row */}
    <rect x="215" y="72" width="175" height="36" rx="20" fill="rgb(var(--primary-muted))" />
    <circle cx="235" cy="90" r="5" fill="#0d9488" />
    <rect x="248" y="87" width="50" height="7" rx="3.5" fill="rgb(var(--primary))" opacity="0.6" />

    {/* User list rows */}
    <rect x="230" y="122" width="144" height="20" rx="6" fill="rgb(var(--background))" stroke="rgb(var(--border))" strokeWidth="1" />
    <circle cx="244" cy="132" r="7" fill="#0d9488" />
    <rect x="258" y="128" width="40" height="6" rx="3" fill="rgb(var(--border))" />
    <rect x="305" y="128" width="20" height="6" rx="3" fill="#10b981" opacity="0.7" />

    <rect x="230" y="150" width="144" height="20" rx="6" fill="rgb(var(--background))" stroke="rgb(var(--border))" strokeWidth="1" />
    <circle cx="244" cy="160" r="7" fill="#6366f1" />
    <rect x="258" y="156" width="40" height="6" rx="3" fill="rgb(var(--border))" />
    <rect x="305" y="156" width="20" height="6" rx="3" fill="#f59e0b" opacity="0.7" />

    <rect x="230" y="178" width="144" height="20" rx="6" fill="rgb(var(--background))" stroke="rgb(var(--border))" strokeWidth="1" />
    <circle cx="244" cy="188" r="7" fill="#f43f5e" />
    <rect x="258" y="184" width="40" height="6" rx="3" fill="rgb(var(--border))" />
    <rect x="305" y="184" width="20" height="6" rx="3" fill="#10b981" opacity="0.7" />

    {/* Analytics bar chart */}
    <rect x="228" y="216" width="144" height="60" rx="8" fill="rgb(var(--background))" stroke="rgb(var(--border))" strokeWidth="1" />
    <rect x="242" y="248" width="14" height="20" rx="3" fill="#0d9488" opacity="0.8" />
    <rect x="262" y="238" width="14" height="30" rx="3" fill="#6366f1" opacity="0.8" />
    <rect x="282" y="243" width="14" height="25" rx="3" fill="#f59e0b" opacity="0.8" />
    <rect x="302" y="233" width="14" height="35" rx="3" fill="#0d9488" />
    <rect x="322" y="240" width="14" height="28" rx="3" fill="#6366f1" />
    <rect x="342" y="245" width="14" height="23" rx="3" fill="#f43f5e" opacity="0.7" />

    {/* Floating shield badge */}
    <g style={{ animation: 'ci-float 5s ease-in-out infinite' }}>
      <circle cx="215" cy="60" r="20" fill="#0d9488" />
      <path d="M215 50 L224 54 V65 C224 72 220 77 215 79 C210 77 206 72 206 65 V54 Z" fill="none" stroke="white" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M210 62 L214 66 L221 58" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </g>
  </svg>
);

export default AdminIllustration;
