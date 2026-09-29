import React, { useEffect, useState } from 'react';
import { authService } from '../services/api';
import { X, ShieldCheck, AlertCircle, CheckCircle2, RefreshCw, Copy } from 'lucide-react';

interface TwoFactorSetupModalProps {
  onClose: () => void;
  onEnabled: () => void;
}

/* Enable-2FA flow: fetch a pending secret + QR code, ask the user to scan it and
   type back a code to prove it actually works, then show the one-time backup
   codes. Mirrors ChangePasswordModal's layout/step conventions. */
export const TwoFactorSetupModal: React.FC<TwoFactorSetupModalProps> = ({ onClose, onEnabled }) => {
  const [loading, setLoading] = useState(true);
  const [qrCode, setQrCode] = useState('');
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await authService.twoFactorSetup();
        if (cancelled) return;
        setQrCode(data.qr_code_base64);
        setSecret(data.secret);
      } catch (err: any) {
        if (!cancelled) setError(err.response?.data?.detail || 'Could not start two-factor setup.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const data = await authService.twoFactorEnable(code.trim());
      setBackupCodes(data.backup_codes);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Invalid code. Check your authenticator app and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopyBackupCodes = async () => {
    if (!backupCodes) return;
    try {
      await navigator.clipboard.writeText(backupCodes.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard access denied - non-fatal, codes are still shown on screen */
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="w-full max-w-md bg-surface rounded-2xl shadow-hover border border-border overflow-hidden animate-fade-up">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-background">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-primary-muted rounded-lg flex items-center justify-center">
              <ShieldCheck className="w-4 h-4 text-primary" />
            </div>
            <h3 className="text-base font-bold text-text-primary">Two-Factor Authentication</h3>
          </div>
          <button onClick={backupCodes ? onEnabled : onClose} className="text-text-muted hover:text-text-primary p-1 rounded-lg hover:bg-background transition-all">
            <X className="w-5 h-5" />
          </button>
        </div>

        {backupCodes ? (
          <div className="p-6 space-y-4">
            <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl p-4 flex items-center gap-2 text-sm">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              Two-factor authentication is now enabled.
            </div>
            <div>
              <p className="text-sm font-semibold text-text-primary mb-1">Save your backup codes</p>
              <p className="text-xs text-text-secondary mb-3">
                Each code can be used once to sign in if you lose access to your authenticator app. Store them somewhere safe - they won't be shown again.
              </p>
              <div className="bg-background border border-border rounded-xl p-3 grid grid-cols-2 gap-2 font-mono text-sm text-text-primary">
                {backupCodes.map((c) => <span key={c}>{c}</span>)}
              </div>
              <button
                type="button"
                onClick={handleCopyBackupCodes}
                className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
              >
                <Copy className="w-3.5 h-3.5" /> {copied ? 'Copied!' : 'Copy codes'}
              </button>
            </div>
            <button onClick={onEnabled} className="btn-primary w-full justify-center">Done</button>
          </div>
        ) : (
          <div className="p-6 space-y-4">
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-600 rounded-xl p-3 text-sm flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {error}
              </div>
            )}

            {loading ? (
              <div className="text-center py-8 text-sm text-text-muted">
                <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" />
                Preparing setup...
              </div>
            ) : (
              <>
                <p className="text-sm text-text-secondary">
                  Scan this QR code with an authenticator app (Google Authenticator, Authy, 1Password, etc.), then enter the 6-digit code it generates.
                </p>
                {qrCode && (
                  <div className="flex justify-center">
                    <img
                      src={`data:image/png;base64,${qrCode}`}
                      alt="Two-factor authentication QR code"
                      className="w-44 h-44 border border-border rounded-xl bg-white p-2"
                    />
                  </div>
                )}
                {secret && (
                  <p className="text-xs text-text-muted text-center break-all">
                    Can't scan it? Enter this key manually: <span className="font-mono text-text-secondary">{secret}</span>
                  </p>
                )}

                <form onSubmit={handleVerify} className="space-y-3 pt-2">
                  <input
                    type="text"
                    inputMode="numeric"
                    autoFocus
                    className="input-light text-center tracking-[0.3em] text-lg"
                    placeholder="000000"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                  />
                  <div className="flex items-center justify-end gap-3">
                    <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
                    <button type="submit" disabled={submitting || !code} className="btn-primary disabled:opacity-60">
                      {submitting ? <><RefreshCw className="w-4 h-4 animate-spin" /> Verifying...</> : 'Verify & Enable'}
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

interface TwoFactorDisableModalProps {
  onClose: () => void;
  onDisabled: () => void;
  hasPassword: boolean;
}

/* Requires re-proving control of the account (password or a live code) before
   turning 2FA off - see backend/app/auth/routes.py two_factor_disable. */
export const TwoFactorDisableModal: React.FC<TwoFactorDisableModalProps> = ({ onClose, onDisabled, hasPassword }) => {
  const [useCode, setUseCode] = useState(!hasPassword);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await authService.twoFactorDisable(useCode ? { code: value.trim() } : { password: value });
      onDisabled();
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Could not verify your password or authentication code.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="w-full max-w-md bg-surface rounded-2xl shadow-hover border border-border overflow-hidden animate-fade-up">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-background">
          <h3 className="text-base font-bold text-text-primary">Disable Two-Factor Authentication</h3>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary p-1 rounded-lg hover:bg-background transition-all">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-600 rounded-xl p-3 text-sm flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}
          <p className="text-sm text-text-secondary">
            {useCode
              ? 'Enter a code from your authenticator app, or an unused backup code.'
              : 'Enter your current password to confirm.'}
          </p>
          <input
            type={useCode ? 'text' : 'password'}
            autoFocus
            required
            className="input-light"
            placeholder={useCode ? '6-digit code or backup code' : 'Current password'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          {hasPassword && (
            <button
              type="button"
              className="text-xs font-semibold text-primary hover:underline"
              onClick={() => { setUseCode((v) => !v); setValue(''); setError(''); }}
            >
              {useCode ? 'Use my password instead' : 'Use an authenticator code instead'}
            </button>
          )}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
            <button type="submit" disabled={submitting || !value} className="btn-primary disabled:opacity-60">
              {submitting ? <><RefreshCw className="w-4 h-4 animate-spin" /> Disabling...</> : 'Disable 2FA'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
