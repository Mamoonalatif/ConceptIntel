import React from 'react';

/**
 * Flat-vector "study" illustration — a seated, faceless character at a desk
 * with a laptop, a stack of books, and a floating chat-bubble + mini chart
 * panel. Style is inspired by unDraw/Storyset flat illustrations (simple
 * geometric shapes, no gradients, no photorealism) but drawn from scratch.
 *
 * Theme-aware: skin/hair use fixed neutral tones (read fine on both light and
 * dark surfaces), clothing/desk/props use the app's CSS variable palette so
 * they automatically adapt between light/dark mode. Books and the chart bars
 * use a few fixed accent hues (amber/rose) borrowed from the landing page's
 * richer marketing palette, purely as decorative props.
 *
 * Used on: Login / Register pages.
 */
export const StudyIllustration: React.FC<{ className?: string; clothingColor?: string }> = ({ className, clothingColor }) => (
  <svg
    className={className}
    viewBox="0 0 400 400"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    {/* ground shadow */}
    <ellipse cx="200" cy="356" rx="150" ry="14" fill="rgb(var(--border))" opacity="0.4" />

    {/* floating mini bar-chart panel */}
    <rect x="36" y="56" width="76" height="58" rx="10" fill="rgb(var(--surface))" stroke="rgb(var(--border))" strokeWidth="2" />
    <rect x="50" y="90" width="10" height="16" rx="2" fill="rgb(var(--primary-light))" />
    <rect x="66" y="80" width="10" height="26" rx="2" fill="#f59e0b" />
    <rect x="82" y="70" width="10" height="36" rx="2" fill="rgb(var(--secondary-light))" />

    {/* floating chat bubble */}
    <rect x="292" y="58" width="78" height="52" rx="16" fill="rgb(var(--surface))" stroke="rgb(var(--border))" strokeWidth="2" />
    <path d="M304 108 L304 122 L320 108 Z" fill="rgb(var(--surface))" stroke="rgb(var(--border))" strokeWidth="2" strokeLinejoin="round" />
    <circle cx="315" cy="84" r="4" fill="rgb(var(--primary))" />
    <circle cx="331" cy="84" r="4" fill="rgb(var(--primary))" />
    <circle cx="347" cy="84" r="4" fill="rgb(var(--primary))" />

    {/* stack of books, left of desk */}
    <rect x="46" y="276" width="70" height="18" rx="3" fill="#fbbf24" />
    <rect x="40" y="294" width="86" height="18" rx="3" fill="rgb(var(--primary-light))" />
    <rect x="48" y="312" width="74" height="18" rx="3" fill="#fb7185" />
    <rect x="42" y="330" width="90" height="18" rx="3" fill="#f59e0b" />

    {/* desk */}
    <rect x="120" y="264" width="8" height="70" rx="2" fill="rgb(var(--secondary-light))" />
    <rect x="272" y="264" width="8" height="70" rx="2" fill="rgb(var(--secondary-light))" />
    <rect x="108" y="250" width="182" height="14" rx="5" fill="rgb(var(--secondary-light))" />

    {/* laptop on desk */}
    <rect x="148" y="236" width="74" height="8" rx="2" fill="#374151" />
    <rect x="154" y="190" width="62" height="48" rx="4" fill="#1f2937" />
    <rect x="159" y="195" width="52" height="38" rx="2" fill="rgb(var(--primary-light))" opacity="0.85" />

    {/* stool */}
    <rect x="212" y="298" width="7" height="52" rx="2" fill="rgb(var(--secondary-light))" />
    <rect x="249" y="298" width="7" height="52" rx="2" fill="rgb(var(--secondary-light))" />
    <rect x="204" y="284" width="58" height="16" rx="8" fill="rgb(var(--secondary-light))" />

    {/* seated person — torso/clothing (theme-aware primary fill by default; an
        explicit clothingColor override lets callers that already tint the
        whole panel in --primary give the figure a distinct color instead) */}
    <rect x="204" y="188" width="62" height="102" rx="26" fill={clothingColor ?? 'rgb(var(--primary))'} />

    {/* arms reaching toward the laptop keyboard (neutral skin tone) */}
    <line x1="212" y1="208" x2="186" y2="232" stroke="#e8b894" strokeWidth="14" strokeLinecap="round" />
    <line x1="256" y1="208" x2="228" y2="234" stroke="#e8b894" strokeWidth="14" strokeLinecap="round" />
    <circle cx="186" cy="232" r="8" fill="#e8b894" />
    <circle cx="228" cy="234" r="8" fill="#e8b894" />

    {/* neck + head */}
    <rect x="225" y="168" width="22" height="20" fill="#e8b894" />
    <circle cx="236" cy="153" r="27" fill="#e8b894" />

    {/* simple hair cap */}
    <path
      d="M209 149 Q209 121 236 121 Q263 121 263 149 L263 139 Q263 127 236 127 Q209 127 209 139 Z"
      fill="#3a2e2a"
    />
  </svg>
);

export default StudyIllustration;
