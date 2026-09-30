// Purpose: scroll-triggered fade-in wrapper used by the landing and About pages.
import React, { useEffect, useRef, useState } from 'react';

/**
 * Scroll-reveal wrapper for the landing/about marketing pages — fades +
 * lifts children in once they enter the viewport, using a plain
 * IntersectionObserver (no animation library). Renders a static, already
 * "visible" state upfront so content isn't hidden if JS/observer support is
 * unavailable — it only adds the reveal transition on top.
 */
export const Reveal: React.FC<{ children: React.ReactNode; delay?: number; className?: string }> = ({
  children,
  delay = 0,
  className = '',
}) => {
  // ref = the wrapper element being watched; visible = has it scrolled into view yet.
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  // Start watching the element; once 15% of it is on screen, reveal it and stop observing (animate only once).
  // The cleanup function disconnects the observer when the component unmounts.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            setVisible(true);
            observer.disconnect();
          }
        });
      },
      { threshold: 0.15 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(24px)',
        transition: `opacity 0.7s ease ${delay}s, transform 0.7s ease ${delay}s`,
      }}
    >
      {children}
    </div>
  );
};

export default Reveal;
