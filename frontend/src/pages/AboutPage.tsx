import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Network,
  ShieldCheck,
  Brain,
  GraduationCap,
  Users,
  Target,
  Lightbulb,
  Upload,
  Sparkles,
  CheckSquare,
  Cpu,
  BarChart3,
  Gamepad2,
  Bell,
  Lock,
  BookOpen,
  UserCheck,
  Layers,
} from 'lucide-react';
import { GraphIllustration, StudyIllustration } from '../components/illustrations';
import logoWhite from '../assets/logo_white.png';
import { Nav } from '../components/landing/Nav';
import { Footer } from '../components/landing/Footer';
import { Reveal } from '../components/landing/Reveal';

/* Same shared heading pattern as LandingPage.tsx so the two pages read as
   one consistent product rather than two differently-styled pages. */
const sectionEyebrow = 'inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-primary-muted border border-primary/20 text-primary text-xs font-bold mb-4';
const sectionHeading = 'text-3xl sm:text-4xl font-extrabold text-text-primary tracking-tight';
const sectionSub = 'text-text-secondary text-base mt-3 leading-relaxed';

const ALL_12_MODULES = [
  {
    title: 'AI Content Upload',
    desc: 'Teachers upload slides, PDFs, textbooks and CLOs/PLOs — AI automatically extracts key concepts.',
    icon: Upload,
    gradient: 'from-teal-500 to-emerald-500',
  },
  {
    title: 'Knowledge Graph',
    desc: 'Course material is structured into an interactive, teacher-editable concept-dependency graph.',
    icon: Network,
    gradient: 'from-cyan-500 to-teal-600',
  },
  {
    title: 'AI Content Generation',
    desc: 'Automated flashcards, MCQs, practice guides, and quizzes built from graph concept nodes.',
    icon: Sparkles,
    gradient: 'from-indigo-500 to-blue-600',
  },
  {
    title: 'Teacher Supervision',
    desc: 'Every single AI output is reviewed and approved by a teacher before students see it.',
    icon: ShieldCheck,
    gradient: 'from-purple-500 to-violet-600',
  },
  {
    title: 'Assignment Evaluation',
    desc: 'Submissions are evaluated at the concept level with actionable, explainable feedback.',
    icon: CheckSquare,
    gradient: 'from-rose-500 to-pink-600',
  },
  {
    title: 'Adaptive Engine',
    desc: 'An agentic learning loop personalizes every student’s path based on their weak concepts.',
    icon: Cpu,
    gradient: 'from-amber-500 to-orange-600',
  },
  {
    title: 'Analytics Dashboard',
    desc: 'Real-time concept-mastery heatmaps and diagnostic bottleneck detection across classes.',
    icon: BarChart3,
    gradient: 'from-emerald-500 to-teal-600',
  },
  {
    title: 'Gamification Engine',
    desc: 'Concept-tied mini-games with adaptive difficulty, badges, and progress milestones.',
    icon: Gamepad2,
    gradient: 'from-yellow-500 to-amber-600',
  },
  {
    title: 'Smart Notifications',
    desc: 'Instant updates for course announcements, newly approved content, quizzes, and grades.',
    icon: Bell,
    gradient: 'from-sky-500 to-blue-600',
  },
  {
    title: 'Role-Based Auth',
    desc: 'Granular, role-scoped security separating students, teachers, coordinators, and admins.',
    icon: Lock,
    gradient: 'from-slate-600 to-slate-800',
  },
  {
    title: 'Course Management',
    desc: 'Centralized hub to create, organize, schedule, and oversee every course module.',
    icon: BookOpen,
    gradient: 'from-teal-600 to-cyan-700',
  },
  {
    title: 'Enrollment & Prerequisites',
    desc: 'Automatic validation of prerequisite mastery whenever a student joins a new course.',
    icon: UserCheck,
    gradient: 'from-indigo-600 to-teal-600',
  },
];

const DIFFERENTIATORS = [
  {
    icon: Network,
    title: 'Concept-graph-driven',
    desc: 'Every course becomes a prerequisite-linked knowledge graph instead of a flat list of modules — so both a gap and its cause are visible, not just a low score.',
    gradient: 'from-teal-500 to-emerald-500',
  },
  {
    icon: Brain,
    title: 'Adaptive, not static',
    desc: 'An agentic observe → analyze → plan → act loop personalizes each student’s path around the concepts they’re actually weak on, instead of a fixed syllabus order.',
    gradient: 'from-violet-500 to-purple-600',
  },
  {
    icon: ShieldCheck,
    title: 'Teacher-in-the-loop, always',
    desc: 'AI drafts the graph, the materials and the feedback — but nothing reaches a student until a teacher has reviewed and approved it. No black-box grading.',
    gradient: 'from-indigo-500 to-blue-600',
  },
];

export const AboutPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background text-text-primary overflow-x-hidden relative">
      {/* Same colored background wash as the homepage, for visual continuity. */}
      <div className="fixed inset-0 -z-10 pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-b from-teal-50 via-background to-background dark:from-teal-950/30 dark:via-background dark:to-background" />
        <div className="absolute top-[-8%] left-1/2 -translate-x-1/2 w-[1100px] h-[700px] rounded-full bg-teal-400/15 dark:bg-teal-500/10 blur-[120px]" />
        <div className="absolute bottom-[-5%] right-[-10%] w-[520px] h-[520px] rounded-full bg-slate-300/10 dark:bg-slate-500/5 blur-[120px]" />
      </div>

      <style>{`
        @keyframes ci-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-12px); } }
        .ci-glass {
          background: rgb(var(--surface) / 0.65);
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          border: 1px solid rgb(var(--border) / 0.7);
        }
        .ci-card-hover { transition: transform 0.25s ease, box-shadow 0.25s ease, border-color 0.25s ease; }
        .ci-card-hover:hover {
          transform: translateY(-6px);
          box-shadow: 0 20px 40px -12px rgb(var(--shadow-color) / 0.18);
          border-color: rgb(var(--primary-light) / 0.4);
        }
        .ci-btn-hover { transition: transform 0.2s ease, box-shadow 0.2s ease; }
        .ci-btn-hover:hover { transform: translateY(-2px); }
      `}</style>

      <Nav active="about" />

      {/* ── HERO HEADER — pt-16 offsets the fixed navbar height ── */}
      <section className="relative pt-20 pb-14 sm:pt-24 sm:pb-16 z-10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <Reveal className="flex flex-col items-center">
            <h1 className="mt-5 text-4xl sm:text-5xl font-extrabold tracking-tight text-text-primary">
              About ConceptIntel
            </h1>
            <p className="mt-4 text-lg text-text-secondary leading-relaxed max-w-2xl">
              A concept-graph-based platform built to make understanding — not just activity — visible to
              teachers and students alike.
            </p>
          </Reveal>
        </div>
      </section>

      {/* ── ORIGIN STORY ── */}
      <section className="relative py-12 z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
            <Reveal className="lg:col-span-7">
              <div className={sectionEyebrow}>
                <GraduationCap className="w-3.5 h-3.5" /> Our Origin
              </div>
              <h2 className={sectionHeading}>A student capstone, not a funded company</h2>
              <div className={`${sectionSub} space-y-4 max-w-2xl`}>
                <p>
                  ConceptIntel started as a Final Year Project at the Faculty of Computing &amp; Artificial
                  Intelligence, Air University, Islamabad (Spring 2026). It's genuinely a student project — built,
                  debugged and iterated on by a small team over a single academic year, not a startup with funding
                  behind it.
                </p>
                <p>
                  The idea came from a simple, recurring gap: existing platforms are very good at managing
                  courses, content delivery and grades, but none of them model how a student actually builds
                  conceptual understanding. A student can pass an assignment while still missing the prerequisite
                  concept it depended on, and a teacher has no easy way to see that until it resurfaces later,
                  usually at exam time.
                </p>
                <p>
                  So instead of another course-management dashboard, we set out to build the missing layer
                  underneath one — a knowledge graph of the actual concepts in a course, kept accurate by the
                  teachers who own that content, and used to drive everything from AI-generated study material to
                  adaptive learning paths and concept-level assignment feedback.
                </p>
              </div>
            </Reveal>
            <Reveal delay={0.1} className="lg:col-span-5 flex justify-center">
              <div className="w-56 sm:w-72" style={{ animation: 'ci-float 6s ease-in-out infinite' }}>
                <GraphIllustration className="w-full h-auto drop-shadow-xl" />
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── THE 12 CORE MODULES SHOWCASE ── */}
      <section className="relative py-14 z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal className="text-center max-w-2xl mx-auto mb-12">
            <div className={sectionEyebrow}>
              <Layers className="w-3.5 h-3.5" /> Platform Architecture
            </div>
            <h2 className={sectionHeading}>The <span className="text-teal-500">12 Modules</span> of ConceptIntel</h2>
            <p className={sectionSub}>
              From raw syllabus upload to personalized adaptive paths — explore all twelve core components that power the platform.
            </p>
          </Reveal>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {ALL_12_MODULES.map((m, i) => {
              const Icon = m.icon;
              return (
                <Reveal key={m.title} delay={(i % 3) * 0.08} className="ci-glass ci-card-hover rounded-2xl shadow-soft p-6 h-full flex flex-col justify-between">
                  <div>
                    <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${m.gradient} flex items-center justify-center mb-4 shadow-sm`}>
                      <Icon className="w-5 h-5 text-white" />
                    </div>
                    <h3 className="text-base font-bold text-text-primary mb-2">{m.title}</h3>
                    <p className="text-sm text-text-secondary leading-relaxed">{m.desc}</p>
                  </div>
                  <div className="mt-4 pt-3 border-t border-border/40 flex items-center justify-between text-xs font-semibold text-text-muted">
                    <span>Module 0{i + 1}</span>
                    <span className="text-teal-600 dark:text-teal-400 font-bold">ConceptIntel</span>
                  </div>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── WHAT WE DO DIFFERENTLY ── */}
      <section className="relative py-12 z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal className="text-center max-w-2xl mx-auto mb-12">
            <div className={sectionEyebrow}>
              <Lightbulb className="w-3.5 h-3.5" /> What's Different
            </div>
            <h2 className={sectionHeading}>Concept-graph-driven, end to end</h2>
            <p className={sectionSub}>
              The same three ideas run through every module — from content upload to student dashboards.
            </p>
          </Reveal>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {DIFFERENTIATORS.map((d, i) => {
              const Icon = d.icon;
              return (
                <Reveal key={d.title} delay={i * 0.08} className="ci-glass ci-card-hover rounded-2xl shadow-soft p-6 h-full">
                  <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${d.gradient} flex items-center justify-center mb-4 shadow-sm`}>
                    <Icon className="w-5 h-5 text-white" />
                  </div>
                  <h3 className="text-base font-bold text-text-primary mb-1.5">{d.title}</h3>
                  <p className="text-sm text-text-secondary leading-relaxed">{d.desc}</p>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── TEAM / PROJECT ── */}
      <section className="relative py-12 z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
            <Reveal className="lg:col-span-5 flex justify-center order-2 lg:order-1">
              <StudyIllustration className="w-56 sm:w-72 h-auto drop-shadow-xl" />
            </Reveal>
            <Reveal delay={0.1} className="lg:col-span-7 order-1 lg:order-2">
              <div className={sectionEyebrow}>
                <Users className="w-3.5 h-3.5" /> The Project
              </div>
              <h2 className={sectionHeading}>Built by a small student team</h2>
              <p className={`${sectionSub} max-w-2xl`}>
                ConceptIntel is designed, built and maintained by a small student team at Air University as our
                Final Year Project, with faculty supervision along the way. It's a work in progress by design —
                currently piloted on real course content (Applied Physics, Digital Logic Design and Calculus) so
                every module gets tested against an actual curriculum rather than a demo dataset.
              </p>
              <div className="mt-6 flex items-center gap-3 text-sm font-semibold text-text-muted">
                <Target className="w-4 h-4 text-primary" />
                Faculty of Computing &amp; Artificial Intelligence, Air University Islamabad — Spring 2026
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="py-14 relative z-10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <Reveal className="rounded-3xl p-12 relative overflow-hidden bg-gradient-to-br from-teal-700 via-teal-600 to-teal-800">
            <div className="relative z-10 space-y-6">
              <div className="flex justify-center">
                <img src={logoWhite} alt="" width={48} height={48} className="w-12 h-12 object-contain" />
              </div>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-white">
                See it in action
              </h2>
              <p className="text-teal-50/90 text-lg max-w-2xl mx-auto leading-relaxed">
                Create an account and explore the concept graph for yourself.
              </p>
              <div className="flex flex-wrap gap-4 justify-center pt-2">
                <button onClick={() => navigate('/register')}
                  className="ci-btn-hover px-8 py-4 text-base font-bold flex items-center gap-2 rounded-xl bg-white text-teal-700 hover:bg-teal-50 shadow-lg">
                  Get Started Free <ArrowRight className="w-5 h-5" />
                </button>
                <button onClick={() => navigate('/')}
                  className="ci-btn-hover px-8 py-4 border-2 border-white/30 rounded-xl text-base font-semibold text-white hover:bg-white/10">
                  Back to Home
                </button>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      <Footer />
    </div>
  );
};

export default AboutPage;
