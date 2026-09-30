// Purpose: modal form for a logged-in user to change their password; signs them out afterwards because old tokens are revoked.
import React, { useState } from 'react';
import { authService } from '../services/api';
import { apiErrorMessage } from '../lib/apiError';
import { useAuth } from '../context/AuthContext';
import { PasswordChecklist, isPasswordValid } from './PasswordChecklist';
import { X, Lock, Eye, EyeOff, AlertCircle, CheckCircle2, XCircle, RefreshCw } from 'lucide-react';

// Props: onClose closes the modal.
interface ChangePasswordModalProps {
  onClose: () => void;
}

export const ChangePasswordModal: React.FC<ChangePasswordModalProps> = ({ onClose }) => {
  // Changing the password revokes every outstanding token server-side (see
  // backend/app/auth/routes.py change_password / User.token_version), including
  // the one this very session is using - so the current session must sign itself
  // out right after, instead of silently 401ing on its next request.
  const { logout } = useAuth();
  // Form field values, show/hide-password toggles, focus/touched flags (control when hints appear), and request status.
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [newPasswordFocused, setNewPasswordFocused] = useState(false);
  const [confirmTouched, setConfirmTouched] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // confirmMismatch: confirm field differs from the new password (shown as an error); confirmMatches: they agree.
  const confirmMismatch = confirmTouched && confirmPassword.length > 0 && confirmPassword !== newPassword;
  const confirmMatches = confirmPassword.length > 0 && confirmPassword === newPassword;

  // Validates the new password and confirmation, then calls the API; shows the success screen or an error message.
  // current_password is optional because Google-only accounts have no password yet.
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!isPasswordValid(newPassword)) {
      setError('New password does not meet the requirements below.');
      return;
    }
    setConfirmTouched(true);
    if (newPassword !== confirmPassword) return;

    setSubmitting(true);
    try {
      await authService.changePassword({
        current_password: currentPassword || undefined,
        new_password: newPassword,
      });
      setSuccess(true);
    } catch (err: any) {
      setError(apiErrorMessage(err, 'Failed to update password.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="w-full max-w-md bg-surface rounded-2xl shadow-hover border border-border overflow-hidden animate-fade-up">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-background">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-primary-muted rounded-lg flex items-center justify-center">
              <Lock className="w-4 h-4 text-primary" />
            </div>
            <h3 className="text-base font-bold text-text-primary">Change Password</h3>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary p-1 rounded-lg hover:bg-background transition-all">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* After success show a sign-in-again prompt; otherwise show the form. */}
        {success ? (
          <div className="p-6">
            <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl p-4 flex items-center gap-2 text-sm mb-4">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              Password updated. For your security, please sign in again with your new password.
            </div>
            <button onClick={logout} className="btn-primary w-full justify-center">Sign in again</button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-600 rounded-xl p-3 text-sm flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {error}
              </div>
            )}

            <div>
              <label className="block text-sm font-semibold text-text-secondary mb-1.5">
                Current Password
              </label>
              <div className="relative">
                <input
                  type={showCurrent ? 'text' : 'password'}
                  className="input-light pr-10"
                  placeholder="Leave blank if you have no password yet (Google sign-in)"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowCurrent((v) => !v)}
                  className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-text-muted hover:text-text-secondary"
                  tabIndex={-1}
                >
                  {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-text-secondary mb-1.5">New Password</label>
              <div className="relative">
                <input
                  type={showNew ? 'text' : 'password'}
                  required
                  className={`input-light pr-10 ${newPassword && !isPasswordValid(newPassword) ? 'input-error' : ''}`}
                  placeholder="Min. 8 characters"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  onFocus={() => setNewPasswordFocused(true)}
                />
                <button
                  type="button"
                  onClick={() => setShowNew((v) => !v)}
                  className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-text-muted hover:text-text-secondary"
                  tabIndex={-1}
                >
                  {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <PasswordChecklist password={newPassword} visible={newPasswordFocused} />
            </div>

            <div>
              <label className="block text-sm font-semibold text-text-secondary mb-1.5">Confirm New Password</label>
              <div className="relative">
                <input
                  type={showConfirm ? 'text' : 'password'}
                  required
                  className={`input-light pr-10 ${confirmMismatch ? 'input-error' : ''}`}
                  placeholder="Re-enter your new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  onFocus={() => {
                    setConfirmTouched(true);
                    setNewPasswordFocused(false);
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm((v) => !v)}
                  className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-text-muted hover:text-text-secondary"
                  tabIndex={-1}
                >
                  {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {/* Live feedback: mismatch error, match confirmation, or nothing. */}
              {confirmMismatch ? (
                <p className="flex items-center gap-1.5 text-xs text-red-600 mt-1.5">
                  <XCircle className="w-3.5 h-3.5 shrink-0" /> Passwords do not match
                </p>
              ) : confirmMatches ? (
                <p className="flex items-center gap-1.5 text-xs text-emerald-600 mt-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> Passwords match
                </p>
              ) : null}
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
              <button type="submit" disabled={submitting} className="btn-primary disabled:opacity-60">
                {submitting ? <><RefreshCw className="w-4 h-4 animate-spin" /> Saving...</> : 'Update Password'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
