import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ChevronRight, Menu, X, LayoutDashboard } from 'lucide-react';
import { ThemeToggle } from '../ThemeToggle';
import { FoxMark } from '../../components/FoxMark';
import { useAuth } from '../../context/AuthContext';
import { defaultDashboardFor } from '../../lib/roleNav';

/**
 * Shared marketing nav bar — rendered sticky on every public page (landing,
 * About, and the three auth pages) so Home/FAQ/About Us/Login/Signup are
 * always one click away, no matter where a visitor lands.
 * `active` marks which nav item should read as "current" (About page passes
 * `active="about"`; the landing page leaves it undefined).
 */
export const Nav: React.FC<{ active?: 'about'; onBrandClick?: () => void }> = ({ active, onBrandClick }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, token } = useAuth();
  // A visitor who happens to already be signed in (e.g. opened "/" in a new tab
  // while logged in elsewhere) should see a way back into the app, not be asked
  // to log in again - matches how GuestRoute already redirects /login itself
  // for a signed-in user, just without yanking them off a page they explicitly
  // navigated to.
  const isSignedIn = Boolean(token && user);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    onScroll();
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const handleBrandClick = () => {
    if (onBrandClick) {
      onBrandClick();
    } else {
      navigate('/');
    }
  };

  const handleHomeClick = () => {
    setMobileMenuOpen(false);
    navigate('/');
  };

  const handleFaqClick = () => {
    setMobileMenuOpen(false);
    if (location.pathname === '/') {
      document.getElementById('faq')?.scrollIntoView({ behavior: 'smooth' });
    } else {
      navigate('/#faq');
    }
  };

  return (
    <header className={`fixed top-0 z-50 w-full transition-all duration-300 ${
      scrolled ? 'bg-surface/90 backdrop-blur-xl shadow-soft border-b border-border' : 'bg-transparent'
    }`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <div className="flex items-center gap-3 cursor-pointer group" onClick={handleBrandClick}>
          <div className="transition-transform group-hover:scale-105">
            <FoxMark className="w-[38px] h-[38px]" />
          </div>
          <div className="flex items-baseline gap-0.5">
            <span className="text-lg font-extrabold tracking-tight text-text-primary">Concept</span>
            <span className="text-lg font-extrabold tracking-tight text-primary">Intel</span>
          </div>
        </div>

        <div className="hidden md:flex items-center gap-3">
          <button
            onClick={handleHomeClick}
            className={`px-4 py-2 text-sm font-semibold rounded-xl transition-all decoration-2 underline-offset-4 ${
              active === undefined && location.pathname === '/'
                ? 'text-primary font-bold underline decoration-primary bg-primary-muted'
                : 'text-text-secondary hover:text-primary hover:font-bold hover:underline hover:decoration-primary hover:bg-primary-muted'
            }`}
          >
            Home
          </button>
          <button
            onClick={handleFaqClick}
            className="px-4 py-2 text-sm font-semibold rounded-xl transition-all decoration-2 underline-offset-4 text-text-secondary hover:text-primary hover:font-bold hover:underline hover:decoration-primary hover:bg-primary-muted"
          >
            FAQ
          </button>
          <button
            onClick={() => navigate('/about')}
            className={`px-4 py-2 text-sm rounded-xl transition-all decoration-2 underline-offset-4 ${
              active === 'about'
                ? 'text-primary font-bold underline decoration-primary bg-primary-muted'
                : 'text-text-secondary font-semibold hover:text-primary hover:font-bold hover:underline hover:decoration-primary hover:bg-primary-muted'
            }`}
          >
            About Us
          </button>
          <ThemeToggle />
          {isSignedIn ? (
            <button onClick={() => navigate(defaultDashboardFor(user!.role))}
              className="rounded-xl text-sm font-bold px-5 py-2 flex items-center gap-1.5 text-white bg-primary hover:bg-primary-hover shadow-glow hover:shadow-lg hover:-translate-y-0.5 hover:underline transition-all">
              <LayoutDashboard className="w-4 h-4" /> Dashboard
            </button>
          ) : (
            <>
              <button onClick={() => navigate('/login')}
                className="px-5 py-2 border border-border rounded-xl text-sm font-semibold text-text-secondary hover:text-primary hover:border-primary/30 hover:bg-primary-muted hover:underline transition-all">
                Login
              </button>
              <button onClick={() => navigate('/register')}
                className="rounded-xl text-sm font-bold px-5 py-2 flex items-center gap-1.5 text-white bg-primary hover:bg-primary-hover shadow-glow hover:shadow-lg hover:-translate-y-0.5 hover:underline transition-all">
                Signup <ChevronRight className="w-4 h-4" />
              </button>
            </>
          )}
        </div>

        <div className="flex md:hidden items-center gap-1">
          <ThemeToggle />
          <button className="p-2 text-text-secondary hover:text-primary rounded-lg hover:bg-primary-muted transition-all"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {mobileMenuOpen && (
        <div className="md:hidden bg-surface/95 backdrop-blur-xl border-t border-border px-4 py-4 space-y-2 shadow-lg">
          <button
            onClick={handleHomeClick}
            className={`block w-full text-left px-4 py-2.5 text-sm rounded-lg transition-all decoration-2 underline-offset-4 ${
              active === undefined && location.pathname === '/'
                ? 'text-primary font-bold underline decoration-primary bg-primary-muted'
                : 'text-text-secondary font-semibold hover:text-primary hover:font-bold hover:underline hover:decoration-primary hover:bg-primary-muted'
            }`}
          >
            Home
          </button>
          <button
            onClick={handleFaqClick}
            className="block w-full text-left px-4 py-2.5 text-sm font-semibold rounded-lg transition-all decoration-2 underline-offset-4 text-text-secondary hover:text-primary hover:font-bold hover:underline hover:decoration-primary hover:bg-primary-muted"
          >
            FAQ
          </button>
          <button
            onClick={() => { setMobileMenuOpen(false); navigate('/about'); }}
            className={`block w-full text-left px-4 py-2.5 text-sm rounded-lg transition-all decoration-2 underline-offset-4 ${
              active === 'about'
                ? 'text-primary font-bold underline decoration-primary bg-primary-muted'
                : 'text-text-secondary font-semibold hover:text-primary hover:font-bold hover:underline hover:decoration-primary hover:bg-primary-muted'
            }`}
          >
            About Us
          </button>
          <div className="flex gap-3 pt-2">
            {isSignedIn ? (
              <button
                onClick={() => { setMobileMenuOpen(false); navigate(defaultDashboardFor(user!.role)); }}
                className="flex-1 py-2.5 text-sm font-bold text-center justify-center rounded-xl text-white bg-primary hover:bg-primary-hover hover:underline flex items-center gap-1.5"
              >
                <LayoutDashboard className="w-4 h-4" /> Dashboard
              </button>
            ) : (
              <>
                <button onClick={() => { setMobileMenuOpen(false); navigate('/login'); }} className="flex-1 py-2.5 border border-border rounded-xl text-sm font-semibold text-text-secondary text-center hover:underline">Login</button>
                <button onClick={() => { setMobileMenuOpen(false); navigate('/register'); }} className="flex-1 py-2.5 text-sm font-bold text-center justify-center rounded-xl text-white bg-primary hover:bg-primary-hover hover:underline">Signup</button>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
};

export default Nav;
