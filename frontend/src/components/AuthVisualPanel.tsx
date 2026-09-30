// Purpose: decorative left-hand panel (logo, illustration, tagline) shown beside the login/register forms on large screens.
import React from 'react';
import { AuthIllustration } from './illustrations';
import { FoxMark } from '../components/FoxMark';

export interface AuthVisualPanelProps {
  /** Short heading shown under the illustration, e.g. "Welcome back". Use
   *  "\n" to force a line break, matching the previous per-page markup. */
  tagline: string;
  /** One or two sentence supporting copy shown under the tagline. */
  description: string;
  /** Optional custom illustration component */
  illustration?: React.FC<{ className?: string }>;
}

// Renders the branded gradient panel; falls back to the default AuthIllustration when no custom one is given.
// Hidden below the `lg` breakpoint so mobile users only see the form.
export const AuthVisualPanel: React.FC<AuthVisualPanelProps> = ({
  tagline,
  description,
  illustration: CustomIllustration,
}) => {
  // Pick the caller's illustration if provided, otherwise the default one.
  const VisualComponent = CustomIllustration || AuthIllustration;

  return (
    <div className="hidden lg:flex lg:w-[42%] bg-gradient-to-br from-primary to-primary-hover relative overflow-hidden flex-col justify-between p-11">
      {/* Logo */}
      <div className="flex items-center gap-3 z-10">
        <FoxMark className="w-[38px] h-[38px]" tone="white" />
        <div className="flex items-baseline gap-0.5">
          <span className="text-white text-lg font-bold">Concept</span>
          <span className="text-white/70 text-lg font-bold">Intel</span>
        </div>
      </div>

      {/* Illustration + tagline */}
      <div className="z-10 flex flex-col items-center text-center">
        <VisualComponent className="w-full max-w-xs drop-shadow-lg" />
        <h2 className="mt-8 text-2xl font-extrabold text-white leading-snug whitespace-pre-line">
          {tagline}
        </h2>
        <p className="mt-3 text-white/70 text-sm leading-relaxed max-w-sm">
          {description}
        </p>
      </div>

      {/* Spacer */}
      <div aria-hidden="true" />
    </div>
  );
};


export default AuthVisualPanel;
