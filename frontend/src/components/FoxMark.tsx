import React from 'react';

interface FoxMarkProps {
  className?: string;
  variant?: 'badge' | 'bare';
  tone?: 'brand' | 'white';
  animated?: boolean;
}

/**
 * ConceptIntel Fox Mark — the same head/face geometry as FoxMascot (see
 * FoxMascot.tsx), cropped to just the head so the small nav/header logo and the
 * favicon read as the SAME character used everywhere else in the app, rather
 * than a separately-drawn, rounder/"cuter" face. Shares FoxMascot's viewBox
 * (0 0 200 200) and coordinates directly - update both together.
 *
 * Default is `variant="bare"` - just the fox shape, no background card - so the
 * mark drops cleanly onto any surface (header, favicon, dark/light panels)
 * without carrying its own colored tile. Pass `variant="badge"` where a
 * standalone tile is actually wanted (e.g. a loose icon with nothing else
 * around it to anchor it).
 */
export const FoxMark: React.FC<FoxMarkProps> = ({
  className = 'w-9 h-9',
  variant = 'bare',
  tone = 'brand',
  animated = true,
}) => {
  const isWhite = tone === 'white';
  const furFill = isWhite ? '#FFFFFF' : '#E85D00';
  const capFill = isWhite ? '#FF7A00' : '#0F172A';

  const face = (
    <svg
      // Cropped tight to the fox glyph itself (the full path data still lives in
      // a 0-200/0-200 space shared with FoxMascot.tsx - see the component
      // docstring) rather than the full square: the glyph only occupies roughly
      // its top 60%, so centering the untrimmed 200x200 box centered empty space
      // below the chin, making the icon look shifted upward next to any text set
      // beside it (flex `items-center` centers bounding boxes, not visible ink).
      viewBox="20 0 160 128"
      fill="none"
      className={`${variant === 'badge' ? 'w-[86%] h-[86%]' : 'w-full h-full'} drop-shadow-sm transition-transform duration-300 group-hover:scale-105`}
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Ears with Black Tips */}
      <g className={animated ? 'transition-transform duration-300 origin-bottom group-hover:-rotate-2' : ''}>
        <path d="M 46 65 L 26 8 Q 64 22 76 56 Z" fill={furFill} />
        <path d="M 26 8 L 34 18 Q 48 18 64 22 Z" fill={capFill} />
        <path d="M 48 58 L 36 20 Q 60 28 70 50 Z" fill={isWhite ? '#FFE8D5' : '#FFF9F5'} opacity="0.95" />
      </g>
      <g className={animated ? 'transition-transform duration-300 origin-bottom group-hover:rotate-2' : ''}>
        <path d="M 154 65 L 174 8 Q 136 22 124 56 Z" fill={furFill} />
        <path d="M 174 8 L 166 18 Q 152 18 136 22 Z" fill={capFill} />
        <path d="M 152 58 L 164 20 Q 140 28 130 50 Z" fill={isWhite ? '#FFE8D5' : '#FFF9F5'} opacity="0.95" />
      </g>

      {/* Head Contour */}
      <path
        d="M 40 58 Q 100 32 160 58 Q 170 88 142 106 Q 100 120 58 106 Q 30 88 40 58 Z"
        fill={furFill}
      />

      {/* White Muzzle & Cheek Patch */}
      <path
        d="M 50 78 L 100 115 L 150 78 Q 158 96 138 105 L 100 120 L 62 105 Q 42 96 50 78 Z"
        fill={isWhite ? '#FFFFFF' : '#FFF9F5'}
      />

      {/* Nose */}
      <polygon points="100,96 106,90 94,90" fill={capFill} />

      {/* Sharp, angular eyes - a level, alert gaze rather than big round "cute"
          eyes. One small catch-light each, no colored iris dot. */}
      <path d="M 64 73 Q 74 62 85 74 Q 74 82 64 73 Z" fill={capFill} />
      <path d="M 136 73 Q 126 62 115 74 Q 126 82 136 73 Z" fill={capFill} />
      <circle cx="70" cy="69" r="1.3" fill="#FFFFFF" />
      <circle cx="130" cy="69" r="1.3" fill="#FFFFFF" />

      {/* Level Brows - straight, slightly angled rather than a soft round arch */}
      <path d="M 60 59 L 87 55" stroke={capFill} strokeWidth="2.5" strokeLinecap="round" opacity="0.85" />
      <path d="M 140 59 L 113 55" stroke={capFill} strokeWidth="2.5" strokeLinecap="round" opacity="0.85" />

      {/* Understated Smile */}
      <path d="M 94 101 Q 100 105 106 101" stroke={capFill} strokeWidth="2.5" strokeLinecap="round" fill="none" />
    </svg>
  );

  if (variant === 'bare') {
    return (
      <div className={`group flex items-center justify-center select-none ${className}`}>
        {face}
      </div>
    );
  }

  return (
    <div
      className={`group rounded-[28%] flex items-center justify-center shrink-0 select-none shadow-md transition-all duration-200 hover:shadow-lg hover:brightness-105 active:scale-95 ${className} ${
        isWhite ? 'bg-white' : 'bg-primary'
      }`}
    >
      {face}
    </div>
  );
};

export default FoxMark;
