// NotFoundPage: catch-all 404 screen shown for unknown routes.
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { EmptyStateIllustration } from '../components/illustrations';

/** 404 - the shrugging "guide" fox stands in for the generic redirect-to-home
 *  this route used to silently do, so a broken/typo'd link reads as an actual
 *  page rather than an unexplained bounce back to the landing page. */
export const NotFoundPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="text-center max-w-sm animate-fade-up">
        <EmptyStateIllustration className="w-40 h-40 mx-auto mb-4" />
        <h1 className="text-2xl font-extrabold text-text-primary">Page not found</h1>
        <p className="text-text-secondary text-sm mt-2 leading-relaxed">
          Even our fox couldn't dig this page up. It may have moved, or the link might be off.
        </p>
        <button onClick={() => navigate('/')} className="btn-primary mt-6 mx-auto">
          <ArrowLeft className="w-4 h-4" /> Back to home
        </button>
      </div>
    </div>
  );
};

export default NotFoundPage;
