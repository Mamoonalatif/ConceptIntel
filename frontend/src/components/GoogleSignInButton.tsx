import React from 'react';
import { GoogleLogin, type CredentialResponse } from '@react-oauth/google';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { apiErrorMessage } from '../lib/apiError';

interface GoogleSignInButtonProps {
  rememberMe?: boolean;
  onSuccess: (role: string) => void;
  onError: (message: string) => void;
  // Called instead of onSuccess when the linked account has 2FA enabled - the
  // caller should collect a code and finish with useAuth().verifyTwoFactor(tempToken, code).
  onRequiresTwoFactor?: (tempToken: string) => void;
}

const isConfigured = Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID);

export const GoogleSignInButton: React.FC<GoogleSignInButtonProps> = ({
  rememberMe = true,
  onSuccess,
  onError,
  onRequiresTwoFactor,
}) => {
  const { loginWithGoogle } = useAuth();
  const { theme } = useTheme();

  if (!isConfigured) {
    return (
      <button
        type="button"
        disabled
        title="Set VITE_GOOGLE_CLIENT_ID to enable Google sign-in"
        className="w-full py-2.5 rounded-xl border border-border bg-card dark:bg-black dark:text-gray-400 text-text-muted text-sm font-medium cursor-not-allowed"
      >
        Google sign-in not configured
      </button>
    );
  }

  const handleSuccess = async (credentialResponse: CredentialResponse) => {
    if (!credentialResponse.credential) {
      onError('Google did not return a credential.');
      return;
    }
    try {
      const data = await loginWithGoogle(credentialResponse.credential, rememberMe);
      if (data?.requires_2fa) {
        if (onRequiresTwoFactor) onRequiresTwoFactor(data.temp_token);
        else onError('This account requires a two-factor code, which is not supported here.');
        return;
      }
      onSuccess(data.role);
    } catch (err: any) {
      onError(apiErrorMessage(err, 'Google sign-in failed.'));
    }
  };

  return (
    <div className="flex justify-center">
      <GoogleLogin
        onSuccess={handleSuccess}
        onError={() => onError('Google sign-in failed.')}
        width={336}
        shape="pill"
        theme={theme === 'dark' ? 'filled_black' : 'outline'}
      />
    </div>
  );
};
