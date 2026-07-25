import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

/**
 * Shared footer for the landing page and the About page. A row of link
 * columns (mirroring the shared Nav's Home / FAQ / About Us / Login / Signup,
 * plus what portals and platform modules already existed from prior work),
 * a divider, then a single centered copyright line — no logo.
 */
export const Footer: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const handleFaqClick = () => {
    if (location.pathname === '/') {
      document.getElementById('faq')?.scrollIntoView({ behavior: 'smooth' });
    } else {
      navigate('/#faq');
    }
  };

  const linkClass = 'text-text-secondary hover:text-primary hover:underline transition-colors text-left';

  return (
    <footer className="bg-background border-t border-border text-text-secondary py-14 relative z-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-8 pb-10 border-b border-border">
          <div className="space-y-3">
            <h4 className="text-xs font-bold text-text-primary uppercase tracking-widest">Navigate</h4>
            <ul className="space-y-2 text-sm">
              <li><button onClick={() => navigate('/')} className={linkClass}>Home</button></li>
              <li><button onClick={handleFaqClick} className={linkClass}>FAQ</button></li>
              <li><button onClick={() => navigate('/about')} className={linkClass}>About Us</button></li>
              <li><button onClick={() => navigate('/login')} className={linkClass}>Login</button></li>
              <li><button onClick={() => navigate('/register')} className={linkClass}>Signup</button></li>
            </ul>
          </div>

          <div className="space-y-3">
            <h4 className="text-xs font-bold text-text-primary uppercase tracking-widest">Portals</h4>
            <ul className="space-y-2 text-sm">
              {['Student Portal', 'Teacher Portal', 'Admin Console', 'Coordinator Dashboard'].map(l => (
                <li key={l}>
                  <button onClick={() => navigate('/login')} className={linkClass}>{l}</button>
                </li>
              ))}
            </ul>
          </div>

          <div className="col-span-2 sm:col-span-2 space-y-3">
            <h4 className="text-xs font-bold text-text-primary uppercase tracking-widest">Platform</h4>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              {['Knowledge Graphs', 'AI Content Generation', 'Assignment Evaluation', 'Adaptive Engine', 'Analytics'].map(l => (
                <li key={l}><span className="text-text-secondary">{l}</span></li>
              ))}
            </ul>
          </div>
        </div>

        <div className="pt-8 text-center">
          <p className="text-sm text-text-secondary">
            © 2026 ConceptIntel — Final Year Project, Air University Islamabad.
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
