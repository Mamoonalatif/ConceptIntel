import React from 'react';

/**
 * Flat-vector "Auth" illustration featuring a character standing beside a digital login terminal,
 * key/shield verification badge, and interactive concept access nodes.
 */
export const AuthIllustration: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    viewBox="0 0 400 400"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    {/* Ground shadows */}
    <ellipse cx="120" cy="370" rx="70" ry="10" fill="rgb(var(--border))" opacity="0.4" />
    <ellipse cx="270" cy="370" rx="90" ry="12" fill="rgb(var(--border))" opacity="0.4" />

    {/* Character figure (standing student/user) */}
    {/* Legs + shoes */}
    <rect x="104" y="284" width="15" height="80" rx="6" fill="rgb(var(--secondary))" />
    <rect x="128" y="284" width="15" height="80" rx="6" fill="rgb(var(--secondary))" />
    <ellipse cx="111" cy="364" rx="14" ry="6" fill="#374151" />
    <ellipse cx="135" cy="364" rx="14" ry="6" fill="#374151" />

    {/* Torso */}
    <rect x="96" y="196" width="56" height="92" rx="24" fill="rgb(var(--primary))" />

    {/* Left arm */}
    <line x1="100" y1="210" x2="84" y2="265" stroke="#e8b894" strokeWidth="13" strokeLinecap="round" />
    <circle cx="84" cy="265" r="8" fill="#e8b894" />

    {/* Right gesturing arm — interacting with security terminal */}
    <line x1="148" y1="210" x2="195" y2="185" stroke="#e8b894" strokeWidth="13" strokeLinecap="round" />
    <circle cx="195" cy="185" r="8" fill="#e8b894" />

    {/* Head & Hair */}
    <rect x="115" y="180" width="18" height="18" fill="#e8b894" />
    <circle cx="124" cy="164" r="24" fill="#e8b894" />
    <path
      d="M100 160 Q100 134 124 134 Q148 134 148 160 L148 150 Q148 138 124 138 Q100 138 100 150 Z"
      fill="#2d3748"
    />

    {/* Central shield/auth panel */}
    <rect x="200" y="80" width="170" height="240" rx="20" fill="rgb(var(--surface))" stroke="rgb(var(--border))" strokeWidth="3" />

    {/* Top lock/shield icon badge */}
    <circle cx="285" cy="135" r="28" fill="rgb(var(--primary-muted))" stroke="rgb(var(--primary))" strokeWidth="2" />
    <path d="M276 137 V130 C276 125 280 121 285 121 C290 121 294 125 294 130 V137" stroke="rgb(var(--primary))" strokeWidth="2.5" strokeLinecap="round" />
    <rect x="274" y="137" width="22" height="16" rx="4" fill="rgb(var(--primary))" />
    <circle cx="285" cy="145" r="2.5" fill="white" />

    {/* Input lines simulation */}
    <rect x="225" y="185" width="120" height="18" rx="6" fill="rgb(var(--primary-muted))" opacity="0.6" />
    <rect x="225" y="215" width="120" height="18" rx="6" fill="rgb(var(--primary-muted))" opacity="0.6" />
    <rect x="225" y="248" width="120" height="22" rx="8" fill="rgb(var(--primary))" />
    <rect x="260" y="255" width="50" height="7" rx="3.5" fill="white" opacity="0.9" />

    {/* Floating concept security badges */}
    <g style={{ animation: 'ci-float 5s ease-in-out infinite' }}>
      <rect x="30" y="85" width="76" height="48" rx="10" fill="rgb(var(--surface))" stroke="rgb(var(--border))" strokeWidth="2" />
      <circle cx="52" cy="109" r="8" fill="#0d9488" />
      <rect x="66" y="105" width="26" height="8" rx="3" fill="rgb(var(--border))" />
    </g>
  </svg>
);
