import React, { useState } from 'react';
import { X, RefreshCw, CheckCircle2 } from 'lucide-react';
import { enrollmentService, courseService } from '../services/api';

const CODE_LENGTH = 8;
const CODE_PATTERN = /^[A-Z0-9]+$/;
const ILLEGAL_CHAR_PATTERN = /[^A-Z0-9]/;
const ILLEGAL_CHAR_MESSAGE = 'Code must be 8 uppercase letters/numbers (no spaces or symbols).';

interface EnrollmentCodeFormProps {
  /** Called with a ready-to-display success message after a successful join. */
  onEnrolled: (message: string) => void;
  /** Called when the dialog should close (Cancel, the X button, or a successful join). */
  onClose: () => void;
}

/**
 * Google Classroom-style "Join class" dialog: title + description, a single
 * labeled "Class code" field, and Cancel/Join actions. All validation and
 * server errors are surfaced inline within this dialog only - never on the
 * page behind it. Client-side validation only covers immediate format
 * feedback (empty / wrong shape); the backend (POST /enrollment/join)
 * remains the single source of truth for all enrollment business rules.
 */
const EnrollmentCodeForm: React.FC<EnrollmentCodeFormProps> = ({ onEnrolled, onClose }) => {
  const [code, setCode] = useState('');
  const [touched, setTouched] = useState(false);
  // Tracks whether the user has clicked into (or started typing in) the code
  // field yet - the generic format hint only appears after that, never before.
  const [interacted, setInteracted] = useState(false);
  const [joining, setJoining] = useState(false);
  const [serverError, setServerError] = useState('');
  const [preview, setPreview] = useState<{ name: string; code: string | null } | null>(null);

  const formatError = (): string => {
    const trimmed = code.trim();
    if (!trimmed) return 'Enrollment code is required.';
    if (trimmed.length !== CODE_LENGTH || !CODE_PATTERN.test(trimmed)) {
      return 'Code must be 8 uppercase letters/numbers (no spaces or symbols).';
    }
    return '';
  };

  // A space or symbol is always invalid, so that specific error surfaces
  // immediately as the user types it - no need to wait for blur/submit.
  // Other errors (empty, wrong length) only show after blur/submit so users
  // aren't flagged as "wrong" mid-way through typing a valid code.
  const hasIllegalChars = ILLEGAL_CHAR_PATTERN.test(code);
  const clientError = hasIllegalChars ? ILLEGAL_CHAR_MESSAGE : touched ? formatError() : '';
  const displayedError = clientError || serverError;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCode(e.target.value.toUpperCase());
    setServerError('');
    setPreview(null);
  };

  const handleFocus = () => setInteracted(true);

  const handleBlur = async () => {
    setTouched(true);
    setPreview(null);
    const trimmed = code.trim().toUpperCase();
    if (!trimmed || formatError()) return;

    // Lightweight, read-only preview lookup - failures here are silent since the
    // authoritative error is always surfaced by the actual join submission.
    try {
      const found = await courseService.lookupByCode(trimmed);
      setPreview(found);
    } catch {
      setPreview(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    setServerError('');

    const trimmed = code.trim().toUpperCase();
    if (formatError()) return;

    setJoining(true);
    try {
      const enrollment = await enrollmentService.join(trimmed);
      const name = enrollment.course_name || 'the course';
      const codeLabel = enrollment.course_code ? ` (${enrollment.course_code})` : '';
      onEnrolled(`Successfully enrolled in ${name}${codeLabel}.`);
    } catch (err: any) {
      setServerError(err.response?.data?.detail || 'Failed to join course. Double-check the code.');
    } finally {
      setJoining(false);
    }
  };

  return (
    <div className="bg-surface rounded-2xl shadow-xl w-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-6 pb-4">
        <h2 className="text-xl font-medium text-text-primary">Join class</h2>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded-full hover:bg-background text-text-muted hover:text-text-primary transition-all"
          title="Close"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="border-t border-border" />

      {/* Body */}
      <form onSubmit={handleSubmit} noValidate>
        <div className="px-6 pt-5 pb-2">
          <p className="text-sm text-text-secondary mb-5">
            Ask your teacher for the class code, then enter it here.
          </p>

          <label htmlFor="enroll-code-input" className="block text-xs font-semibold text-text-muted uppercase tracking-wide mb-1.5">
            Class code
          </label>
          <input
            type="text"
            required
            maxLength={CODE_LENGTH}
            placeholder="e.g. R05YTMDX"
            id="enroll-code-input"
            autoComplete="off"
            className={`w-full px-3.5 py-2.5 bg-background border-2 rounded-lg text-text-primary focus:outline-none text-base font-mono font-semibold tracking-widest uppercase placeholder:text-text-muted placeholder:font-normal placeholder:tracking-normal placeholder:text-sm transition-all ${
              displayedError ? 'border-red-300 focus:border-red-400' : 'border-border focus:border-secondary'
            }`}
            value={code}
            onChange={handleChange}
            onFocus={handleFocus}
            onBlur={handleBlur}
          />

          {displayedError ? (
            <p className="text-xs text-red-500 mt-1.5">{displayedError}</p>
          ) : preview ? (
            <p className="text-xs text-emerald-600 mt-1.5 flex items-center gap-1 font-medium">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              Course found: {preview.name}{preview.code ? ` (${preview.code})` : ''}
            </p>
          ) : interacted ? (
            <p className="text-[11px] text-text-muted mt-1.5">
              Codes are {CODE_LENGTH} characters — letters and numbers only.
            </p>
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-bold uppercase tracking-wide text-text-secondary hover:bg-background rounded-full transition-all"
          >
            Cancel
          </button>
          <button
            type="submit"
            id="enroll-submit"
            disabled={joining || !code.trim()}
            className="px-5 py-2 bg-secondary hover:bg-secondary-hover text-white rounded-full font-bold text-xs uppercase tracking-wide transition-all disabled:opacity-40 flex items-center gap-1.5"
          >
            {joining && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
            {joining ? 'Joining...' : 'Join'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default EnrollmentCodeForm;
