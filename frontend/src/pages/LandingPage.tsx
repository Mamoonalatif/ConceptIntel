import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutGrid,
  ArrowRight,
  Network,
  ShieldCheck,
  CheckCircle,
  MessageSquare,
  XCircle,
  Brain,
  BarChart3,
  Globe,
  HelpCircle,
  Plus,
  Minus,
  Search,
  Send,
  Loader2,
  Upload,
  GraduationCap,
} from 'lucide-react';
import { StudyIllustration, TeachIllustration, AdminIllustration, FAQIllustration } from '../components/illustrations';
import { Nav } from '../components/landing/Nav';
import { Footer } from '../components/landing/Footer';
import { Reveal } from '../components/landing/Reveal';
import { contactService } from '../services/api';

/* ─────────────────────────────────────────────
   Shared heading pattern — every section on the homepage (Features, How It
   Works, Roles, Comparison, FAQ, About) uses this exact size/weight/color/
   spacing combo so the page doesn't feel like it was stitched from
   differently-styled sections.
───────────────────────────────────────────── */
const sectionHeading = 'text-3xl sm:text-4xl font-extrabold text-text-primary tracking-tight';
const sectionSub = 'text-text-secondary text-base mt-3 leading-relaxed';

/* ─────────────────────────────────────────────
   Hero illustration — a small two-person scene rather than a single
   centered icon-graphic: the teacher gestures at the knowledge-graph panel
   while a student studies alongside, echoing the "teach & learn together"
   headline. Credibility stat cards float around the pair.
───────────────────────────────────────────── */
const HeroVisual: React.FC = () => (
  <div className="relative w-full flex items-center justify-center">
    {/* Single teacher illustration — the smaller, redundant student figure
        that used to overlap it here was removed to avoid two competing
        visuals in the hero. */}
    <div className="relative z-20 w-full max-w-md" style={{ animation: 'ci-float 6s ease-in-out infinite' }}>
      <TeachIllustration className="w-full h-auto drop-shadow-xl" />
    </div>

    {/* Floating stat callouts */}
    <div className="absolute top-0 right-0 sm:-right-6 z-20 ci-glass rounded-2xl p-3 shadow-card w-32" style={{ animation: 'ci-fade-up 0.6s ease-out 0.4s both' }}>
      <p className="text-[9px] font-bold text-text-muted uppercase tracking-wider">Concept mastery</p>
      <p className="text-lg font-extrabold text-teal-600 dark:text-teal-400">+34%</p>
    </div>
    <div className="absolute bottom-4 left-0 sm:-left-6 z-20 ci-glass rounded-2xl p-3 shadow-card w-32" style={{ animation: 'ci-fade-up 0.6s ease-out 0.6s both' }}>
      <p className="text-[9px] font-bold text-text-muted uppercase tracking-wider">Concepts mapped</p>
      <p className="text-lg font-extrabold text-text-primary">2,847</p>
    </div>
  </div>
);

const HOW_IT_WORKS = [
  {
    step: '01',
    icon: Upload,
    title: 'Teacher uploads content',
    desc: 'Slides, PDFs, textbooks and CLOs/PLOs in one place.',
    color: 'from-teal-500 to-emerald-500',
  },
  {
    step: '02',
    icon: Network,
    title: 'AI builds concept graph',
    desc: 'Extracts concepts & prerequisite dependencies.',
    color: 'from-cyan-500 to-teal-600',
  },
  {
    step: '03',
    icon: ShieldCheck,
    title: 'Teacher reviews & approves',
    desc: 'Supervises & refines AI graph before student access.',
    color: 'from-indigo-500 to-blue-600',
  },
  {
    step: '04',
    icon: GraduationCap,
    title: 'Adaptive learning path',
    desc: 'Personalized paths tailored to concept gaps.',
    color: 'from-slate-500 to-slate-600',
  },
];

interface RoleInfo {
  role: string;
  desc: string;
  Visual: React.FC<{ className?: string }>;
}

const ROLES: RoleInfo[] = [
  {
    role: 'Student',
    desc: 'Explore the knowledge graph and follow an adaptive learning path.',
    Visual: StudyIllustration,
  },
  {
    role: 'Teacher',
    desc: 'Upload content, curate the concept graph, and supervise every AI output.',
    Visual: TeachIllustration,
  },
  {
    role: 'Admin',
    desc: 'Platform-wide oversight of programs, staff accounts, and access requests.',
    Visual: AdminIllustration,
  },
];

/* Course/Program Coordinator are conceptually teachers with added
   institutional duties, so they surface as small chips inside the Teacher
   card rather than as their own full cards. */
const TEACHER_SUBROLES = [
  { label: 'Course Coordinator', icon: LayoutGrid },
  { label: 'Program Coordinator', icon: ShieldCheck },
];

const FAQS = [
  {
    q: 'Is this a real product or a student project?',
    a: 'A Final Year Project at Air University Islamabad, under active development — not yet a commercial product.',
  },
  {
    q: 'What subjects does it support?',
    a: 'Any subject — currently piloted on Applied Physics, Digital Logic Design and Calculus.',
  },
  {
    q: 'Do I need to be technical to use it?',
    a: 'No. Teachers upload content like normal; the AI and dashboards handle the rest.',
  },
  {
    q: 'Is a human always involved in grading?',
    a: 'Yes. Every AI-generated grade, resource or graph edit is reviewed and approved by a teacher first.',
  },
  {
    q: "What if my course doesn't have a knowledge graph yet?",
    a: 'Upload your content once and the AI drafts one automatically — teachers refine it from there.',
  },
  {
    q: 'Is student data safe? Who can see progress?',
    a: 'Access is role-scoped — teachers see only their own students, coordinators oversee their programs.',
  },
  {
    q: 'How do I create an account?',
    a: 'Click "Get Started" or "Signup", fill in your name, email and password — students and teachers both register the same way.',
  },
  {
    q: 'How do I join a course as a student?',
    a: 'After signing in, enter the course join code your teacher shared with you — you\'ll be enrolled instantly.',
  },
  {
    q: 'How do I upload course materials as a teacher?',
    a: 'From your Teacher Dashboard, open a course and upload slides, PDFs or textbooks — the AI extracts concepts automatically.',
  },
];

/* ─────────────────────────────────────────────
   "What makes ConceptIntel unique" — short, punchy one-line value props,
   replacing the old named-competitor comparison strip. Icon-badge cards with
   Reveal scroll-animation, matching the rest of the page's animation language.
───────────────────────────────────────────── */
const UNIQUE_FEATURES = [
  {
    icon: Network,
    title: 'Concept-graph-driven, not just content delivery',
    gradient: 'from-teal-500 to-emerald-500',
  },
  {
    icon: ShieldCheck,
    title: 'Teacher approves every AI output',
    gradient: 'from-indigo-500 to-blue-600',
  },
  {
    icon: Globe,
    title: 'Works for any subject',
    gradient: 'from-slate-500 to-slate-600',
  },
  {
    icon: Brain,
    title: 'Adaptive paths, not a fixed syllabus',
    gradient: 'from-violet-500 to-purple-600',
  },
  {
    icon: BarChart3,
    title: 'Concept-level analytics, not just grades',
    gradient: 'from-rose-500 to-pink-600',
  },
];

/* ─────────────────────────────────────────────
   In-page "About" benefits — three short, ConceptIntel-specific value
   propositions, each with a colored icon-circle (benefits-strip pattern).
───────────────────────────────────────────── */
const BENEFITS = [
  {
    icon: Network,
    title: 'Concept-level insight, not just grades',
    desc: 'Every course becomes a concept-dependency graph, so gaps are visible long before a final score would show them.',
    gradient: 'from-teal-500 to-emerald-500',
  },
  {
    icon: ShieldCheck,
    title: 'Teacher-supervised AI, end-to-end',
    desc: 'AI drafts the graph and the materials — a teacher reviews and approves every one before a student ever sees it.',
    gradient: 'from-indigo-500 to-blue-600',
  },
  {
    icon: Globe,
    title: 'Subject-agnostic by design',
    desc: 'Built for Applied Physics, Digital Logic Design and Calculus alike — the same pipeline adapts to any curriculum.',
    gradient: 'from-slate-500 to-slate-600',
  },
];

/* ─────────────────────────────────────────────
   Main LandingPage
───────────────────────────────────────────── */
export const LandingPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [openFaq, setOpenFaq] = useState<string | null>(FAQS[0]?.q ?? null);
  const [faqQuery, setFaqQuery] = useState('');
  const filteredFaqs = FAQS.filter(item => item.q.toLowerCase().includes(faqQuery.trim().toLowerCase()));

  const [contactForm, setContactForm] = useState({ name: '', email: '', message: '' });
  const [contactStatus, setContactStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');
  const [contactFormOpen, setContactFormOpen] = useState(false);

  // Scroll to the FAQ section when arriving via the shared Nav/Footer's FAQ
  // link from another page (e.g. "/#faq"), matching the in-page scroll
  // behavior used when already on the landing page.
  useEffect(() => {
    if (location.hash === '#faq') {
      const t = setTimeout(() => {
        document.getElementById('faq')?.scrollIntoView({ behavior: 'smooth' });
      }, 150);
      return () => clearTimeout(t);
    }
  }, [location]);

  const handleContactSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setContactStatus('sending');
    try {
      await contactService.send(contactForm);
      setContactStatus('success');
      setContactForm({ name: '', email: '', message: '' });
    } catch {
      setContactStatus('error');
    }
  };

  return (
    <div className="min-h-screen bg-background text-text-primary overflow-x-hidden relative">
      {/* ── Colored page background wash (marketing page only — richer than
          the flat dashboard background, tied to the teal brand color) ── */}
      <div className="fixed inset-0 -z-10 pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-b from-teal-50 via-background to-background dark:from-teal-950/30 dark:via-background dark:to-background" />
        <div className="absolute top-[-8%] left-1/2 -translate-x-1/2 w-[1100px] h-[700px] rounded-full bg-teal-400/15 dark:bg-teal-500/10 blur-[120px]" />
        <div className="absolute top-[45%] right-[-12%] w-[560px] h-[560px] rounded-full bg-slate-300/10 dark:bg-slate-500/5 blur-[120px]" />
        <div className="absolute bottom-[-5%] left-[-10%] w-[520px] h-[520px] rounded-full bg-rose-300/10 dark:bg-rose-500/5 blur-[120px]" />
      </div>

      <style>{`
        @keyframes ci-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-12px); } }
        @keyframes ci-fade-up { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes ci-blob { 0%, 100% { transform: translate(0, 0) scale(1); } 33% { transform: translate(24px, -18px) scale(1.06); } 66% { transform: translate(-18px, 14px) scale(0.96); } }
        .ci-fade-up { animation: ci-fade-up 0.6s ease-out both; }
        .ci-blob { animation: ci-blob 16s ease-in-out infinite; }

        /* Glassmorphism panel — backdrop-blur surface, reintroduced specifically
           for this marketing page (dashboards stay flat/opaque). */
        .ci-glass {
          background: rgb(var(--surface) / 0.65);
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          border: 1px solid rgb(var(--border) / 0.7);
        }

        /* Satisfying hover-lift for every interactive card, darkened slightly
           on hover so the lift reads clearly against the page background. */
        .ci-card-hover { transition: transform 0.25s ease, box-shadow 0.25s ease, border-color 0.25s ease, background-color 0.25s ease; }
        .ci-card-hover:hover {
          transform: translateY(-6px);
          box-shadow: 0 20px 40px -12px rgb(var(--shadow-color) / 0.18);
          border-color: rgb(var(--primary-light) / 0.4);
          background-color: rgb(var(--surface) / 0.85);
        }
        .dark .ci-card-hover:hover { background-color: rgb(0 0 0 / 0.25); }

        .ci-btn-hover { transition: transform 0.2s ease, box-shadow 0.2s ease, background-color 0.2s ease; }
        .ci-btn-hover:hover { transform: translateY(-2px); }

        /* Animated connector line between "How It Works" steps — a moving
           gradient pulse instead of a static line, to read as a live pipeline. */
        @keyframes ci-flow { 0% { background-position: 0% 0; } 100% { background-position: 200% 0; } }
        .ci-connector {
          background: linear-gradient(90deg, rgb(var(--primary)) 0%, rgb(var(--primary-light)) 25%, rgb(var(--border)) 50%, rgb(var(--primary-light)) 75%, rgb(var(--primary)) 100%);
          background-size: 200% 100%;
          animation: ci-flow 3s linear infinite;
        }
      `}</style>

      <Nav />

      {/* ── HERO SECTION — pt-16 compensates for the fixed navbar height ── */}
      <section className="relative overflow-hidden pt-16">
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="ci-blob absolute -top-24 -left-16 w-96 h-96 rounded-full bg-teal-400/20 dark:bg-teal-500/10 blur-3xl" />
          <div className="ci-blob absolute top-40 -right-24 w-[28rem] h-[28rem] rounded-full bg-slate-300/20 dark:bg-slate-500/10 blur-3xl" style={{ animationDelay: '4s' }} />
          <div className="ci-blob absolute bottom-0 left-1/3 w-80 h-80 rounded-full bg-rose-300/15 dark:bg-rose-500/10 blur-3xl" style={{ animationDelay: '8s' }} />
        </div>

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-14 pb-16">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
            <div className="lg:col-span-6 space-y-7">
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-[1.05] ci-fade-up">
                Teach & Learn by
                <br />
                <span className="bg-gradient-to-r from-teal-700 via-teal-600 to-teal-700 bg-clip-text text-transparent">
                  Concept
                </span>
                <span className="text-text-primary">, Not Just </span>
                <span className="text-slate-600 dark:text-slate-400">Content</span>
              </h1>

              <p className="text-lg text-text-secondary leading-relaxed max-w-xl ci-fade-up" style={{ animationDelay: '0.1s' }}>
                Most platforms track courses and grades — not understanding. ConceptIntel maps your curriculum into a
                knowledge graph, so every gap is visible and every path is adaptive.
              </p>

              <div className="flex flex-wrap gap-4 ci-fade-up" style={{ animationDelay: '0.2s' }}>
                <button onClick={() => navigate('/register')}
                  className="ci-btn-hover px-7 py-3.5 text-base font-bold flex items-center gap-2 rounded-xl text-white bg-gradient-to-r from-teal-700 to-teal-600 hover:from-teal-800 hover:to-teal-700 shadow-glow">
                  Get Started <ArrowRight className="w-5 h-5" />
                </button>
                <a href="#how-it-works"
                  className="ci-btn-hover ci-glass px-7 py-3.5 rounded-xl text-base font-semibold text-text-secondary hover:text-primary flex items-center gap-2 shadow-soft">
                  See How It Works
                </a>
              </div>
            </div>

            <div className="lg:col-span-6 flex justify-center items-center">
              <div className="relative w-full max-w-md">
                <HeroVisual />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── ABOUT (benefits layout) ── */}
      <section id="about" className="relative py-12 sm:py-14 z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal className="text-center max-w-2xl mx-auto mb-10">
            
            <h2 className={sectionHeading}>Built to make <span className="text-teal-700 dark:text-teal-400">understanding</span> visible</h2>
          </Reveal>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
            <Reveal className="lg:col-span-5 flex justify-center order-2 lg:order-1">
              <StudyIllustration className="w-56 sm:w-72 h-auto drop-shadow-xl" />
            </Reveal>

            <Reveal delay={0.1} className="lg:col-span-7 order-1 lg:order-2">
           

              <div className="mt-7 space-y-2">
                {BENEFITS.map(b => {
                  const Icon = b.icon;
                  return (
                    <div
                      key={b.title}
                      className="group flex items-start gap-4 rounded-2xl p-4 -mx-4 transition-all duration-200 hover:bg-primary-muted/60 hover:-translate-y-0.5 cursor-default"
                    >
                      <div className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 shadow-sm bg-gradient-to-br ${b.gradient} transition-transform duration-200 group-hover:scale-110`}>
                        <Icon className="w-5 h-5 text-white" />
                      </div>
                      <div>
                        <h3 className="text-base font-bold text-text-primary mb-1">{b.title}</h3>
                        <p className="text-sm text-text-secondary leading-relaxed">{b.desc}</p>
                      </div>
                    </div>
                  );
                })}
              </div>

              <button onClick={() => navigate('/about')}
                className="ci-btn-hover mt-6 inline-flex items-center gap-2 text-sm font-bold text-primary hover:text-primary-hover">
                Read the full story <ArrowRight className="w-4 h-4" />
              </button>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section id="how-it-works" className="relative py-14 z-10">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-card/50 to-transparent pointer-events-none" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative">
          <Reveal className="text-center max-w-2xl mx-auto mb-14">
            <h2 className={sectionHeading}>From syllabus to <span className="text-teal-700 dark:text-teal-400">adaptive</span> path</h2>
            <p className={sectionSub}>
              Teacher-supervised at every step — nothing reaches a student unchecked.
            </p>
          </Reveal>

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            {HOW_IT_WORKS.map((item, i) => {
              const Icon = item.icon;
              return (
                <Reveal key={item.step} delay={i * 0.08} className="relative">
                  {i < HOW_IT_WORKS.length - 1 && (
                    <div className="ci-connector hidden lg:block absolute top-8 left-[calc(50%+2.5rem)] right-[-1.5rem] h-0.5 rounded-full" />
                  )}
                  <div className="ci-glass ci-card-hover rounded-2xl shadow-soft p-6 h-full">
                    <div className="flex items-center gap-3 mb-4">
                      <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${item.color} flex items-center justify-center shadow-sm shrink-0`}>
                        <Icon className="w-5 h-5 text-white" />
                      </div>
                      <span className="text-2xl font-extrabold text-border">{item.step}</span>
                    </div>
                    <h3 className="text-base font-bold text-text-primary mb-1.5">{item.title}</h3>
                    <p className="text-sm text-text-secondary leading-relaxed">{item.desc}</p>
                  </div>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── ROLES ── */}
      <section id="roles" className="py-14 relative z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal className="text-center max-w-2xl mx-auto mb-12">
            
            <h2 className={sectionHeading}>Made for <span className="text-teal-700 dark:text-teal-400">teaching and learning</span> first</h2>
            <p className={sectionSub}>
              Built around teachers and students first — coordinators and admins keep the institution running.
            </p>
          </Reveal>

          {/* Three cards, one row, tiered "staircase": Teacher raised and
              emphasized in the center (tallest), Student and Admin lower on
              either side — reads as intentionally staggered rather than three
              flat, identical-height cards. */}
          <div className="flex flex-col sm:flex-row items-center sm:items-end justify-center gap-6">
            {ROLES.map((role, i) => {
              const Visual = role.Visual;
              const isTeacher = role.role === 'Teacher';
              return (
                <Reveal
                  key={role.role}
                  delay={i * 0.1}
                  className={`ci-card-hover rounded-3xl border border-border bg-card shadow-card p-7 w-full sm:max-w-xs flex flex-col items-center text-center ${
                    isTeacher ? 'sm:-translate-y-6 sm:scale-105 z-10 border-primary/30' : 'sm:translate-y-3'
                  }`}
                >
                  <div className="w-40 h-40 mb-5 flex items-center justify-center">
                    <Visual className="w-full h-full drop-shadow-sm" />
                  </div>
                  <h3 className="text-lg font-bold text-text-primary mb-1.5">{role.role}</h3>
                  <p className="text-sm text-text-secondary leading-relaxed mb-4">{role.desc}</p>

                  {isTeacher && (
                    <div className="mb-4">
                      <p className="text-[10px] font-bold text-text-muted uppercase tracking-wider mb-2">Also available as</p>
                      <div className="flex flex-wrap justify-center gap-2">
                        {TEACHER_SUBROLES.map(sub => {
                          const SubIcon = sub.icon;
                          return (
                            <span key={sub.label} className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary-muted border border-primary/20 text-primary text-xs font-semibold">
                              <SubIcon className="w-3 h-3" /> {sub.label}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <button onClick={() => navigate('/register')}
                    className="ci-btn-hover mt-auto px-5 py-2.5 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-teal-700 to-teal-600 hover:from-teal-800 hover:to-teal-700 shadow-glow inline-flex items-center gap-2">
                    Get Started <ArrowRight className="w-4 h-4" />
                  </button>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── WHAT MAKES CONCEPTINTEL UNIQUE ── */}
      <section className="py-12 relative z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal className="ci-glass rounded-3xl p-8">
            <div className="text-center max-w-2xl mx-auto mb-10">
             
              <h2 className={sectionHeading}>Where ConceptIntel is <span className="text-teal-700 dark:text-teal-400">different</span></h2>
              <p className={sectionSub}>Subject-agnostic, concept-graph-driven, and always teacher-in-the-loop.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              {UNIQUE_FEATURES.map((f, i) => {
                const Icon = f.icon;
                return (
                  <Reveal key={f.title} delay={i * 0.06} className="ci-card-hover rounded-xl border border-border bg-surface/60 p-5 text-center flex flex-col items-center h-full">
                    <div className="w-11 h-11 rounded-xl border border-teal-500/30 flex items-center justify-center mb-3 text-teal-500 transition-colors">
                      <Icon className="w-6 h-6 stroke-teal-500 stroke-[1.75]" />
                    </div>
                    <p className="text-sm font-bold text-text-primary leading-snug">{f.title}</p>
                  </Reveal>
                );
              })}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section id="faq" className="py-14 relative z-10 overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal className="text-center max-w-2xl mx-auto mb-10">
           
            <h2 className={sectionHeading}>Frequently Asked <span className="text-teal-700 dark:text-teal-400">Questions</span></h2>
            <p className={sectionSub}>Can't find what you're looking for? Search below or check the answers we get asked most.</p>
          </Reveal>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
            {/* Left: search + scrollable accordion */}
            <div className="lg:col-span-7">
              <Reveal delay={0.05} className="relative mb-6">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                <input
                  type="text"
                  value={faqQuery}
                  onChange={e => setFaqQuery(e.target.value)}
                  placeholder="Search question here"
                  className="w-full pl-11 pr-4 py-3.5 rounded-xl border border-border bg-surface text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-primary/50 shadow-soft"
                />
              </Reveal>

              {/* Fixed-height, independently scrolling question list — sized to
                  roughly match the illustration column's height so a long FAQ
                  list scrolls within itself instead of stretching the section
                  (and the illustration beside it) to match its length. */}
              <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1.5 -mr-1.5">
                {filteredFaqs.length === 0 && (
                  <Reveal className="ci-glass rounded-2xl p-5 text-sm text-text-secondary text-center">
                    No questions match "{faqQuery}".
                  </Reveal>
                )}
                {filteredFaqs.map((item, i) => {
                  const isOpen = openFaq === item.q;
                  return (
                    <Reveal key={item.q} delay={i * 0.03} className="ci-glass ci-card-hover rounded-2xl shadow-soft overflow-hidden">
                      <button
                        onClick={() => setOpenFaq(isOpen ? null : item.q)}
                        className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left"
                        aria-expanded={isOpen}
                      >
                        <span className="text-sm font-bold text-text-primary">{item.q}</span>
                        <span className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center border border-border text-text-muted transition-transform ${isOpen ? 'rotate-180 bg-primary-muted text-primary border-primary/30' : ''}`}>
                          {isOpen ? <Minus className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                        </span>
                      </button>
                      {isOpen && (
                        <p className="px-5 pb-4 text-sm text-text-secondary leading-relaxed">{item.a}</p>
                      )}
                    </Reveal>
                  );
                })}
              </div>
            </div>

            {/* Right: illustrated character next to giant "FAQ" lettering, with
                floating question-mark doodles — teal-themed echo of the reference
                image's playful FAQ visual. Hidden on small screens, plenty of
                whitespace elsewhere on the page already. */}
            <Reveal delay={0.1} className="hidden lg:flex lg:col-span-5 justify-center relative h-full min-h-[420px] items-center">
              <span className="absolute -top-2 right-4 text-[7rem] font-extrabold text-primary/10 dark:text-primary/25 leading-none select-none tracking-tight">
                FAQ
              </span>
              <HelpCircle className="absolute top-6 left-2 w-9 h-9 text-slate-400/50" style={{ animation: 'ci-float 6s ease-in-out infinite' }} />
              <HelpCircle className="absolute bottom-16 right-2 w-6 h-6 text-teal-400/50" style={{ animation: 'ci-float 7s ease-in-out infinite', animationDelay: '1s' }} />
              <span className="absolute top-16 right-10 text-3xl font-extrabold text-teal-500/30 select-none" style={{ animation: 'ci-float 5s ease-in-out infinite', animationDelay: '0.5s' }}>?</span>
              <span className="absolute bottom-10 left-6 text-2xl font-extrabold text-slate-400/40 select-none" style={{ animation: 'ci-float 6.5s ease-in-out infinite', animationDelay: '1.5s' }}>?</span>
              <div className="absolute top-1/3 right-0 w-2.5 h-2.5 rounded-full bg-teal-400/50" style={{ animation: 'ci-float 4s ease-in-out infinite' }} />
              <div className="absolute bottom-1/4 left-0 w-2 h-2 rounded-full bg-slate-400/50" style={{ animation: 'ci-float 5.5s ease-in-out infinite', animationDelay: '0.8s' }} />

              <FAQIllustration className="relative z-10 w-64 sm:w-80 h-auto drop-shadow-xl" />
            </Reveal>
          </div>
        </div>
      </section>

    

      {/* ── CONTACT ── */}
      <section id="contact" className="py-12 relative z-10">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal className="ci-glass rounded-3xl p-8 sm:p-10 text-center">
            <h2 className="text-xl sm:text-2xl font-extrabold text-text-primary mb-2">Questions? <span className="text-teal-700 dark:text-teal-400">Reach out.</span></h2>
            <p className="text-text-secondary text-sm leading-relaxed max-w-xl mx-auto">
              Got a question we didn't cover? Check the FAQ above, or send us a message directly and we'll get
              back to you.
            </p>

            {!contactFormOpen ? (
              <button
                onClick={() => setContactFormOpen(true)}
                className="ci-btn-hover mt-6 px-6 py-3 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-teal-700 to-teal-600 hover:from-teal-800 hover:to-teal-700 shadow-glow inline-flex items-center gap-2"
              >
                <MessageSquare className="w-4 h-4" /> Contact Us
              </button>
            ) : (
              <form onSubmit={handleContactSubmit} className="mt-8 space-y-4 text-left max-w-xl mx-auto">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <input
                    type="text"
                    required
                    value={contactForm.name}
                    onChange={e => setContactForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="Your name"
                    className="w-full px-4 py-3 rounded-xl border border-border bg-surface text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-primary/50"
                  />
                  <input
                    type="email"
                    required
                    value={contactForm.email}
                    onChange={e => setContactForm(f => ({ ...f, email: e.target.value }))}
                    placeholder="Your email"
                    className="w-full px-4 py-3 rounded-xl border border-border bg-surface text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-primary/50"
                  />
                </div>
                <textarea
                  required
                  rows={4}
                  value={contactForm.message}
                  onChange={e => setContactForm(f => ({ ...f, message: e.target.value }))}
                  placeholder="Your message"
                  className="w-full px-4 py-3 rounded-xl border border-border bg-surface text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-primary/50 resize-none"
                />
                <div className="flex items-center gap-4">
                  <button
                    type="submit"
                    disabled={contactStatus === 'sending'}
                    className="ci-btn-hover shrink-0 px-6 py-3 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-teal-700 to-teal-600 hover:from-teal-800 hover:to-teal-700 shadow-glow inline-flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:translate-y-0">
                    {contactStatus === 'sending' ? (
                      <>Sending <Loader2 className="w-4 h-4 animate-spin" /></>
                    ) : (
                      <>Send Message <Send className="w-4 h-4" /></>
                    )}
                  </button>
                  {contactStatus === 'success' && (
                    <span className="text-sm font-semibold text-teal-600 dark:text-teal-400 inline-flex items-center gap-1.5">
                      <CheckCircle className="w-4 h-4" /> Message sent!
                    </span>
                  )}
                  {contactStatus === 'error' && (
                    <span className="text-sm font-semibold text-rose-500 inline-flex items-center gap-1.5">
                      <XCircle className="w-4 h-4" /> Something went wrong — please try again.
                    </span>
                  )}
                </div>
              </form>
            )}
          </Reveal>
        </div>
      </section>

      <Footer />
    </div>
  );
};
