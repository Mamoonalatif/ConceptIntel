import React from 'react';

export type MascotPose =
  | 'happy'
  | 'focused'
  | 'thinking'
  | 'excited'
  | 'supportive'
  | 'confident'
  | 'waving'
  | 'cheering'
  | 'celebrating'
  | 'study_smart'
  | 'teaching'
  | 'peeking'
  | 'sleeping'
  | 'confused';

export type MascotRole = 'student' | 'teacher' | 'admin' | 'default';

export interface FoxMascotProps {
  pose?: MascotPose;
  role?: MascotRole;
  size?: number | string;
  className?: string;
  animated?: boolean;
}

/**
 * Foxy Mascot — Distinct Getups for Student, Teacher, Admin & Default Roles.
 * Featuring solid opacity, big round eyes, zero overlaps, and professional attire.
 */
export const FoxMascot: React.FC<FoxMascotProps> = ({
  pose = 'happy',
  role = 'default',
  size = 140,
  className = '',
  animated = true,
}) => {
  const animClass = animated
    ? 'transition-all duration-300 transform hover:scale-105 cursor-pointer select-none opacity-100'
    : 'select-none opacity-100';

  return (
    <div
      className={`inline-flex items-center justify-center relative select-none ${animClass} ${className}`}
      style={{ width: size, height: size }}
    >
      <svg
        viewBox="0 0 200 200"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-full drop-shadow-xl"
      >
        <defs>
          <linearGradient id="proFoxFur" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#FF7A00" />
            <stop offset="60%" stopColor="#E85D00" />
            <stop offset="100%" stopColor="#C84000" />
          </linearGradient>

          <linearGradient id="proFoxChest" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#FFFFFF" />
            <stop offset="100%" stopColor="#FFF2E8" />
          </linearGradient>

          {/* Student Hoodie */}
          <linearGradient id="studentCoat" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#1E293B" />
            <stop offset="100%" stopColor="#0F172A" />
          </linearGradient>

          {/* Teacher Blazer */}
          <linearGradient id="teacherBlazer" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#0F172A" />
            <stop offset="100%" stopColor="#1E1B4B" />
          </linearGradient>

          {/* Admin Executive Suit */}
          <linearGradient id="adminSuit" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#020617" />
            <stop offset="100%" stopColor="#090D16" />
          </linearGradient>
        </defs>

        {/* --- LAYER 1: TAIL --- */}
        <g className={animated ? 'animate-[wiggle_4s_ease-in-out_infinite]' : ''}>
          <path
            d="M 130 130 C 190 120 200 170 148 180 C 122 185 116 155 130 130 Z"
            fill="url(#proFoxFur)"
          />
          <path
            d="M 172 142 C 188 152 178 168 158 174 C 154 164 162 152 172 142 Z"
            fill="#FFF9F5"
          />
        </g>

        {/* --- LAYER 2: ROLE-BASED DISTINCT OUTFIT GETUP --- */}
        {role === 'teacher' ? (
          /* TEACHER / PROFESSOR GETUP: Tailored Blazer + White Collared Shirt + Fox Orange Tie */
          <g>
            <path d="M 45 140 C 45 118 100 118 155 118 C 155 140 160 188 160 188 L 40 188 Z" fill="url(#teacherBlazer)" />
            {/* White Dress Shirt Collars */}
            <path d="M 80 118 L 100 148 L 120 118 Z" fill="#FFFFFF" />
            <path d="M 82 118 L 96 132 L 74 128 Z" fill="#F1F5F9" />
            <path d="M 118 118 L 104 132 L 126 128 Z" fill="#F1F5F9" />
            {/* Fox-Orange Professor Necktie */}
            <path d="M 96 130 L 104 130 L 107 172 L 100 180 L 93 172 Z" fill="#FF7A00" />
            {/* Teacher Gold Badge Pin */}
            <circle cx="68" cy="148" r="4.5" fill="#FFD700" stroke="#B45309" strokeWidth="1" />
          </g>
        ) : role === 'admin' ? (
          /* ADMIN / INSTITUTIONAL GETUP: Executive Dark Suit + Blue Executive Tie + Golden Star Lapel Pin */
          <g>
            <path d="M 45 140 C 45 118 100 118 155 118 C 155 140 160 188 160 188 L 40 188 Z" fill="url(#adminSuit)" />
            {/* White Executive Shirt */}
            <path d="M 82 118 L 100 148 L 118 118 Z" fill="#FFFFFF" />
            {/* Lapels */}
            <path d="M 45 140 L 78 120 L 85 152 Z" fill="#1E293B" />
            <path d="M 155 140 L 122 120 L 115 152 Z" fill="#1E293B" />
            {/* Dark Blue Tie */}
            <path d="M 96 128 L 104 128 L 106 170 L 100 178 L 94 170 Z" fill="#1E3A8A" />
            {/* Institutional Star Lapel Pin (✦) */}
            <path d="M 68 142 Q 68 145 65 145 Q 68 145 68 148 Q 68 145 71 145 Q 68 145 68 142 Z" fill="#FFD700" />
          </g>
        ) : role === 'student' ? (
          /* STUDENT GETUP: Slate Hoodie + Backpack Straps */
          <g>
            <path d="M 45 140 C 45 118 100 118 155 118 C 155 140 160 188 160 188 L 40 188 Z" fill="url(#studentCoat)" />
            {/* Inner V-Neck Shirt */}
            <path d="M 86 118 L 100 138 L 114 118 Z" fill="#FFF9F5" />
            <path d="M 88 126 L 88 148" stroke="#475569" strokeWidth="2" strokeLinecap="round" />
            <path d="M 112 126 L 112 148" stroke="#475569" strokeWidth="2" strokeLinecap="round" />
            {/* Backpack Straps */}
            <path d="M 62 120 L 68 188" stroke="#334155" strokeWidth="6" strokeLinecap="round" />
            <path d="M 138 120 L 132 188" stroke="#334155" strokeWidth="6" strokeLinecap="round" />
            <circle cx="68" cy="155" r="3" fill="#FFD700" />
            <circle cx="132" cy="155" r="3" fill="#FFD700" />
          </g>
        ) : (
          /* DEFAULT / NEUTRAL GETUP */
          <g>
            <path d="M 45 140 C 45 118 100 118 155 118 C 155 140 160 188 160 188 L 40 188 Z" fill="url(#studentCoat)" />
            <path d="M 86 118 L 100 138 L 114 118 Z" fill="#FFF9F5" />
            <path d="M 88 126 L 88 148" stroke="#475569" strokeWidth="2" strokeLinecap="round" />
            <path d="M 112 126 L 112 148" stroke="#475569" strokeWidth="2" strokeLinecap="round" />
          </g>
        )}

        {/* --- LAYER 3: HEAD & FACE --- */}
        <g>
          {/* Ears with Black Tips */}
          <g>
            <path d="M 46 65 L 26 8 Q 64 22 76 56 Z" fill="url(#proFoxFur)" />
            <path d="M 26 8 L 34 18 Q 48 18 64 22 Z" fill="#0F172A" />
            <path d="M 48 58 L 36 20 Q 60 28 70 50 Z" fill="#FFF9F5" opacity="0.95" />
          </g>

          <g>
            <path d="M 154 65 L 174 8 Q 136 22 124 56 Z" fill="url(#proFoxFur)" />
            <path d="M 174 8 L 166 18 Q 152 18 136 22 Z" fill="#0F172A" />
            <path d="M 152 58 L 164 20 Q 140 28 130 50 Z" fill="#FFF9F5" opacity="0.95" />
          </g>

          {/* Head Contour */}
          <path
            d="M 40 58 Q 100 32 160 58 Q 170 88 142 106 Q 100 120 58 106 Q 30 88 40 58 Z"
            fill="url(#proFoxFur)"
          />

          {/* White Muzzle & Cheek Patch */}
          <path
            d="M 50 78 L 100 115 L 150 78 Q 158 96 138 105 L 100 120 L 62 105 Q 42 96 50 78 Z"
            fill="url(#proFoxChest)"
          />

          {/* Nose */}
          <polygon points="100,96 106,90 94,90" fill="#0F172A" />

          {/* BIG ROUND EYES */}
          {pose === 'sleeping' ? (
            <>
              <path d="M 66 76 Q 76 84 86 76" stroke="#0F172A" strokeWidth="3.5" strokeLinecap="round" fill="none" />
              <path d="M 114 76 Q 124 84 134 76" stroke="#0F172A" strokeWidth="3.5" strokeLinecap="round" fill="none" />
            </>
          ) : (
            <>
              <g>
                <ellipse cx="74" cy="74" rx="10" ry="11" fill="#0F172A" />
                <ellipse cx="126" cy="74" rx="10" ry="11" fill="#0F172A" />

                <circle cx="71" cy="71" r="3.6" fill="#FFFFFF" />
                <circle cx="123" cy="71" r="3.6" fill="#FFFFFF" />

                <circle cx="77" cy="77" r="1.6" fill="#38BDF8" />
                <circle cx="129" cy="77" r="1.6" fill="#38BDF8" />
              </g>

              <path d="M 62 58 Q 74 52 86 58" stroke="#0F172A" strokeWidth="2.5" strokeLinecap="round" fill="none" opacity="0.85" />
              <path d="M 114 58 Q 126 52 138 58" stroke="#0F172A" strokeWidth="2.5" strokeLinecap="round" fill="none" opacity="0.85" />
            </>
          )}

          {/* Confident Friendly Smile */}
          <path d="M 92 102 Q 100 108 108 102" stroke="#0F172A" strokeWidth="2.5" strokeLinecap="round" fill="none" />

          {/* 4-Point Sparkle Star Accent (✦) on Fur Forehead */}
          <path
            d="M 152 40 Q 152 43 148 43 Q 152 43 152 46 Q 152 43 156 43 Q 152 43 152 40 Z"
            fill="#FFD700"
          />
        </g>
      </svg>
    </div>
  );
};

export default FoxMascot;
