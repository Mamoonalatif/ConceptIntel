import React from 'react';
import { GoogleLogin, type CredentialResponse } from '@react-oauth/google';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../contexts/ThemeContext';

interface GoogleSignInButtonProps {
  rememberMe?: boolean;
  onSuccess: (role: string) => void;
  onError: (message: string) => void;
}

const isConfigured = Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID);

export const GoogleSignInButton: React.FC<GoogleSignInButtonProps> = ({
  rememberMe = true,
  onSuccess,
  onError,
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
      onSuccess(data.role);
    } catch (err: any) {
      onError(err.response?.data?.detail || 'Google sign-in failed.');
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
