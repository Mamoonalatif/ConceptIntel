import React from 'react';

/**
 * Flat-vector "FAQ" illustration featuring a character figure inspecting a query lightbulb panel.
 */
export const FAQIllustration: React.FC<{ className?: string }> = ({ className }) => (
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
    <rect x="86" y="196" width="56" height="92" rx="24" fill="rgb(var(--primary))" />

    {/* Left arm */}
    <line x1="90" y1="210" x2="74" y2="265" stroke="#e8b894" strokeWidth="13" strokeLinecap="round" />
    <circle cx="74" cy="265" r="8" fill="#e8b894" />

    {/* Right gesturing arm — pointing at lightbulb */}
    <line x1="138" y1="210" x2="190" y2="175" stroke="#e8b894" strokeWidth="13" strokeLinecap="round" />
    <circle cx="190" cy="175" r="8" fill="#e8b894" />

    {/* Head & Hair */}
    <rect x="105" y="180" width="18" height="18" fill="#e8b894" />
    <circle cx="114" cy="164" r="24" fill="#e8b894" />
    <path
      d="M90 160 Q90 134 114 134 Q138 134 138 160 L138 150 Q138 138 114 138 Q90 138 90 150 Z"
      fill="#1e293b"
    />

    {/* FAQ query panel */}
    <rect x="190" y="90" width="180" height="220" rx="20" fill="rgb(var(--surface))" stroke="rgb(var(--border))" strokeWidth="3" />

    {/* Search bar mock */}
    <rect x="208" y="115" width="144" height="34" rx="10" fill="rgb(var(--background))" stroke="rgb(var(--border))" strokeWidth="1.5" />
    <circle cx="225" cy="132" r="6" stroke="rgb(var(--primary))" strokeWidth="2" fill="none" />
    <line x1="229" y1="136" x2="234" y2="141" stroke="rgb(var(--primary))" strokeWidth="2" strokeLinecap="round" />
    <rect x="242" y="128" width="70" height="7" rx="3.5" fill="rgb(var(--border))" />

    {/* Question pill cards */}
    <rect x="208" y="165" width="144" height="32" rx="8" fill="rgb(var(--primary-muted))" />
    <circle cx="224" cy="181" r="7" fill="#0d9488" />
    <text x="221.5" y="184.5" fill="white" fontSize="10" fontWeight="bold">?</text>
    <rect x="238" y="177" width="80" height="7" rx="3.5" fill="rgb(var(--text-primary))" opacity="0.8" />

    <rect x="208" y="209" width="144" height="32" rx="8" fill="rgb(var(--background))" stroke="rgb(var(--border))" strokeWidth="1.5" />
    <circle cx="224" cy="225" r="7" fill="#6366f1" />
    <text x="221.5" y="228.5" fill="white" fontSize="10" fontWeight="bold">?</text>
    <rect x="238" y="221" width="70" height="7" rx="3.5" fill="rgb(var(--border))" />

    {/* Floating lightbulb badge */}
    <g style={{ animation: 'ci-float 5s ease-in-out infinite' }}>
      <circle cx="345" cy="110" r="22" fill="#f59e0b" />
      <path d="M340 110 C340 105 342.5 101 345 101 C347.5 101 350 105 350 110 C350 113 348.5 115 347 117 V119 H343 V117 C341.5 115 340 113 340 110 Z" fill="white" />
    </g>
  </svg>
);
