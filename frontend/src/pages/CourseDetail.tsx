import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  courseService, uploadService, enrollmentService, contentProcessingService,
  type ContentSearchResult,
} from '../services/api';
import type { GraphBuildJob, GraphRevision } from '../services/api';
import { useAutoRefresh } from '../hooks/useAutoRefresh';
import { ClassStream } from '../components/ClassStream';
import { Assignments } from '../components/Assignments';
import { ContentGeneration } from '../components/ContentGeneration';
import { Gamification } from '../components/Gamification';
import { RevisionPlanCard } from '../components/RevisionPlan';
import { OutcomeAttainment } from '../components/OutcomeAttainment';
import { DiffGraphPreview } from '../components/DiffGraphPreview';
import { GraphSubmissionLog } from '../components/GraphSubmissionLog';
import { COURSE_THEME_PALETTE, getCourseBannerClass } from '../lib/courseTheme';
import { getPrimaryNavItems } from '../lib/roleNav';
import { AppShell, type NavItem } from '../components/AppShell';
import { apiErrorMessage } from '../lib/apiError';
import {
  BookOpen, Upload, FileText, Trash2, RefreshCw,
  Users, CheckCircle2, AlertTriangle, Play, Network, Copy, Download,
  TrendingUp, Clock, Search, Sparkles, X, ThumbsUp, ThumbsDown, Link as LinkIcon,
  MessageSquare, ClipboardList, Trophy, CalendarDays, type LucideIcon
} from 'lucide-react';
import { EmptyStateIllustration } from '../components/illustrations';
import { FoxSpinner } from '../components/FoxSpinner';

// The course page's sections. Declared once, outside the component, so the tab bar
// and the panel conditions can never drift apart. teacherOnly sections are filtered
// out for students rather than rendered empty - a student has no upload pipeline,
// no coordinator submission log and no class roster to look at.
type SectionKey = 'stream' | 'classwork' | 'study' | 'materials' | 'graph' | 'progress' | 'people';

const ALL_SECTIONS: { key: SectionKey; label: string; icon: LucideIcon; teacherOnly?: boolean }[] = [
  { key: 'stream', label: 'Stream', icon: MessageSquare },
  { key: 'classwork', label: 'Classwork', icon: ClipboardList },
  { key: 'study', label: 'Study material', icon: Sparkles },
  { key: 'materials', label: 'Files & search', icon: FileText },
  { key: 'graph', label: 'Concept graph', icon: Network, teacherOnly: true },
  { key: 'progress', label: 'Progress', icon: Trophy },
  { key: 'people', label: 'People', icon: Users, teacherOnly: true },
];

// Pipeline stages that mean "still running" - keep polling while in one of these.
const NON_TERMINAL_JOB_STATUSES = [
  'Queued', 'ExtractingText', 'CleaningAndStructuring', 'Diffing',
  'AwaitingTeacherReview', 'AwaitingCoordinatorApproval',
];

const JOB_STATUS_LABELS: Record<string, string> = {
  Queued: 'Queued',
  ExtractingText: 'Extracting text',
  CleaningAndStructuring: 'AI cleaning & structuring concepts',
  Diffing: 'Comparing against existing graph',
  AwaitingTeacherReview: 'Awaiting your review',
  AwaitingCoordinatorApproval: 'Awaiting coordinator approval',
  Merged: 'Merged into concept graph',
  Rejected: 'Rejected',
  Failed: 'Failed',
};

interface Course {
  id: number;
  name: string;
  code: string;
  semester: string;
  enrollment_code: string;
  max_students: number;
  status: string;
  teacher_id: number;
  prerequisite_course_id: number | null;
  theme_color?: string | null;
  catalog_id?: number | null;
}

interface UploadedFile {
  id: number;
  filename: string;
  file_type: string;
  file_size: number;
  status: string;
  material_kind?: string;
  rag_status?: string;
  rag_error?: string | null;
  created_at: string;
}

interface EnrolledStudent {
  student_id: number;
  full_name: string;
  email: string;
  status: string;
  progress: number;
}


const CourseDetail: React.FC = () => {
  const { courseId } = useParams<{ courseId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();

  const idNum = parseInt(courseId || '0');

  const [course, setCourse] = useState<Course | null>(null);
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [students, setStudents] = useState<EnrolledStudent[]>([]);
  const [myProgress, setMyProgress] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  // Which kind of document the next upload is. Chosen explicitly rather than inferred
  // from the filename - see the upload card for why the distinction matters.
  const [uploadKind, setUploadKind] = useState<'material' | 'outline'>('material');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ContentSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);

  // Reviewed AI pipeline (trigger -> Kimi structuring -> diff -> teacher review ->
  // coordinator approval -> merge) - separate from the legacy instant "Rebuild Graph".
  const [pipelineJobs, setPipelineJobs] = useState<GraphBuildJob[]>([]);
  const [triggeringPipeline, setTriggeringPipeline] = useState(false);
  const [reviewRevision, setReviewRevision] = useState<GraphRevision | null>(null);
  const [loadingRevision, setLoadingRevision] = useState(false);
  const [decidingRevision, setDecidingRevision] = useState(false);
  const [reviewNotes, setReviewNotes] = useState('');

  const isTeacher = user?.role === 'teacher';
  const latestJob = pipelineJobs[0] || null;

  // Which section of the course is on screen. Everything below used to render at
  // once; each of these is a distinct task, so only one is mounted at a time.
  // Initial value honors a ?tab= link (e.g. "View in Classwork" after creating an
  // assignment from a generated draft), falling back to the stream as before.
  const initialTab = searchParams.get('tab') as SectionKey | null;
  const validInitialTab: SectionKey = ALL_SECTIONS.some((s) => s.key === initialTab) ? (initialTab as SectionKey) : 'stream';
  const [activeSection, setActiveSection] = useState<SectionKey>(validInitialTab);

  const sections = React.useMemo(
    () => ALL_SECTIONS.filter((s) => (s.teacherOnly ? isTeacher : true)),
    [isTeacher]
  );

  // If a role change (or landing via a link) leaves the active section invisible,
  // fall back to the stream rather than rendering an empty page.
  useEffect(() => {
    if (!sections.some((s) => s.key === activeSection)) setActiveSection('stream');
  }, [sections, activeSection]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const results = await uploadService.searchContent(idNum, searchQuery.trim());
      setSearchResults(results);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Search failed.');
    } finally {
      setSearching(false);
    }
  };

  const fetchData = async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const courseData = await courseService.getDetails(idNum);
      setCourse(courseData);
      const filesData = await uploadService.getCourseFiles(idNum);
      setFiles(filesData);
      if (isTeacher) {
        const studentsData = await enrollmentService.getEnrolledStudents(idNum);
        setStudents(studentsData);
        const jobsData = await contentProcessingService.listJobsForCourse(idNum);
        setPipelineJobs(jobsData);
      } else {
        const myCourses = await enrollmentService.getMyCourses();
        const mine = myCourses.find((e: any) => e.course_id === idNum);
        setMyProgress(mine ? Math.round(mine.progress) : null);
      }
    } catch (err: any) {
      if (!silent) setError('Failed to load course details. Ensure backend connection is active.');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  // Especially useful here: a file's status (Uploaded -> Processing -> Completed)
  // updates in the background - this shows that progress without a manual refresh.
  useAutoRefresh(() => { if (idNum) fetchData(true); });

  useEffect(() => {
    if (idNum) fetchData();
  }, [courseId]);

  // Poll the latest pipeline job every 4s while it's still running, so status
  // (Queued -> ExtractingText -> ... -> AwaitingTeacherReview) updates live without
  // the teacher needing to refresh the page.
  useEffect(() => {
    if (!isTeacher || !latestJob || !NON_TERMINAL_JOB_STATUSES.includes(latestJob.status)) return;
    const interval = setInterval(async () => {
      try {
        const updated = await contentProcessingService.getJob(latestJob.id);
        setPipelineJobs((prev) => prev.map((j) => (j.id === updated.id ? updated : j)));
      } catch {
        // transient poll failure - next tick will retry
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [isTeacher, latestJob?.id, latestJob?.status]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;
    setUploading(true);
    setError('');
    setSuccess('');
    try {
      await uploadService.uploadFile(idNum, selectedFile, uploadKind);
      setSuccess(
        uploadKind === 'outline'
          ? `"${selectedFile.name}" uploaded as the course outline. It won't be indexed for search - it's used to scope concept extraction.`
          : `"${selectedFile.name}" uploaded as course material. AI processing started.`
      );
      fetchData();
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not upload this file.'));
    } finally {
      setUploading(false);
    }
  };

  const handleFileReplace = async (fileId: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;
    setUploading(true);
    setError('');
    setSuccess('');
    try {
      await uploadService.replaceFile(fileId, selectedFile);
      setSuccess(`"${selectedFile.name}" uploaded successfully, replacing the old file. AI processing started.`);
      fetchData();
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to replace file');
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteFile = async (fileId: number) => {
    if (!window.confirm('Are you sure you want to delete this document?')) return;
    try {
      await uploadService.deleteFile(fileId);
      setSuccess('Document deleted successfully.');
      setFiles(files.filter(f => f.id !== fileId));
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not delete this document.'));
    }
  };

  const handleReprocessFile = async (fileId: number) => {
    try {
      await uploadService.reprocessFile(fileId);
      setSuccess('Re-triggered text extraction & concept mining.');
      fetchData();
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not restart processing for this file.'));
    }
  };

  const handleTriggerPipeline = async () => {
    setTriggeringPipeline(true);
    setError('');
    setSuccess('');
    try {
      const job = await contentProcessingService.triggerPipeline(idNum);
      setPipelineJobs((prev) => [job, ...prev]);
      setSuccess('AI review pipeline started - this runs in the background and can take a minute or more.');
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to start the AI review pipeline.');
    } finally {
      setTriggeringPipeline(false);
    }
  };

  const handleOpenReview = async (jobId: number) => {
    setLoadingRevision(true);
    setError('');
    setReviewNotes('');
    try {
      const revision = await contentProcessingService.getJobRevision(jobId);
      setReviewRevision(revision);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Could not load the proposed changes for review.');
    } finally {
      setLoadingRevision(false);
    }
  };

  const handleTeacherDecision = async (action: 'confirm' | 'reject') => {
    if (!reviewRevision) return;
    setDecidingRevision(true);
    setError('');
    try {
      await contentProcessingService.teacherReview(reviewRevision.id, action, undefined, reviewNotes || undefined);
      setSuccess(
        action === 'confirm'
          ? 'Sent to the course coordinator for final approval.'
          : 'Revision rejected - it will not be added to the concept graph.'
      );
      setReviewRevision(null);
      setReviewNotes('');
      const jobsData = await contentProcessingService.listJobsForCourse(idNum);
      setPipelineJobs(jobsData);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to submit your review decision.');
    } finally {
      setDecidingRevision(false);
    }
  };

  const handleCopyCode = () => {
    if (course?.enrollment_code) {
      navigator.clipboard.writeText(course.enrollment_code);
      setSuccess('Enrollment code copied!');
      setTimeout(() => setSuccess(''), 3000);
    }
  };

  const handleCopyJoinLink = () => {
    if (course?.enrollment_code) {
      navigator.clipboard.writeText(`${window.location.origin}/join/${course.enrollment_code}`);
      setSuccess('Join link copied!');
      setTimeout(() => setSuccess(''), 3000);
    }
  };

  const completedFiles = files.filter(f => f.status === 'Completed').length;
  const avgProgress = students.length
    ? Math.round(students.reduce((sum, s) => sum + s.progress, 0) / students.length)
    : 0;

  // AppShell already renders Calendar/Analytics/AI Assistant/Settings globally -
  // this page has no unique nav items of its own, and no "back" link needed.
  // Same role-specific top section as the user's own dashboard, so the sidebar
  // looks identical everywhere instead of collapsing to just the global links.
  const backNavItems: NavItem[] = getPrimaryNavItems(user, navigate);

  if (loading) {
    return (
      <AppShell roleLabel="Course" logoIcon={BookOpen} navItems={backNavItems}>
        <div className="flex flex-col items-center justify-center gap-4 py-24">
          <FoxSpinner className="w-12 h-12" label="Loading course details..." />
        </div>
      </AppShell>
    );
  }

  if (!course) {
    return (
      <AppShell roleLabel="Course" logoIcon={BookOpen} navItems={backNavItems}>
        <div className="flex flex-col items-center justify-center p-6">
          <AlertTriangle className="w-16 h-16 text-amber-400 mb-4" />
          <h3 className="text-xl font-bold text-text-primary mb-2">Course Not Found</h3>
          <button onClick={() => navigate(-1)} className="btn-primary mt-2">Go Back</button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell roleLabel={course.name} logoIcon={BookOpen} navItems={backNavItems}>
        {/* Banners */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-600 dark:bg-red-500/10 dark:border-red-500/30 dark:text-red-400 rounded-xl p-4 mb-5 text-sm flex items-center gap-2 animate-fade-in">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {success && (
          <div className="bg-primary-muted border border-primary/20 text-primary rounded-xl p-4 mb-5 text-sm flex items-center gap-2 animate-fade-in">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{success}</span>
          </div>
        )}

        {/* Course Hero Banner */}
        <div className="rounded-2xl overflow-hidden border border-border shadow-card mb-6 animate-fade-up bg-surface">
          <div className={`relative px-6 sm:px-8 pt-8 pb-12 bg-gradient-to-br ${getCourseBannerClass(course)}`}>
            <div className="flex items-center justify-between">
              <span className="inline-block bg-white/20 backdrop-blur-sm text-white text-xs font-bold px-2.5 py-0.5 rounded-lg uppercase tracking-wider">
                {course.code || 'NO-CODE'}
              </span>
              {isTeacher && (
                <div className="flex items-center gap-1.5 bg-black/20 backdrop-blur-sm rounded-full px-2 py-1.5">
                  {Object.keys(COURSE_THEME_PALETTE).map((key) => (
                    <button
                      key={key}
                      onClick={() => {
                        // Optimistic - the banner recolors the instant you click,
                        // not after the network round trip. Reverts only if the
                        // save actually fails.
                        const previousColor = course.theme_color;
                        setCourse((prev) => (prev ? { ...prev, theme_color: key } : prev));
                        courseService.update(course.id, { theme_color: key }).catch(() => {
                          setCourse((prev) => (prev ? { ...prev, theme_color: previousColor } : prev));
                        });
                      }}
                      className={`w-4 h-4 rounded-full bg-gradient-to-br ${COURSE_THEME_PALETTE[key]} ${
                        course.theme_color === key ? 'ring-2 ring-white' : ''
                      }`}
                      title={`Set theme: ${key}`}
                    />
                  ))}
                </div>
              )}
            </div>
            <h2 className="text-2xl md:text-3xl font-extrabold text-white mt-2 drop-shadow-sm">{course.name}</h2>
            <div className="flex items-center gap-4 mt-2 text-sm text-white/85">
              <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{course.semester}</span>
              <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" />Max {course.max_students}</span>
            </div>

            {/* Overlapping avatar */}
            <div className="absolute -bottom-6 right-6 sm:right-8 w-16 h-16 rounded-full bg-surface p-1 shadow-md">
              <div className="w-full h-full rounded-full bg-primary-muted flex items-center justify-center">
                <BookOpen className="w-7 h-7 text-primary" />
              </div>
            </div>
          </div>

          <div className="px-6 sm:px-8 pt-8 pb-6">
            <div className="flex flex-wrap items-center gap-3 justify-end -mt-2 mb-2">
              {isTeacher && (
                <div className="flex items-center gap-2 bg-background border border-border rounded-xl px-4 py-2">
                  <span className="text-text-muted text-xs font-medium">Code:</span>
                  <span className="font-mono font-bold tracking-widest text-text-primary text-sm">{course.enrollment_code}</span>
                  <button onClick={handleCopyCode} className="p-1 hover:bg-primary-muted rounded text-text-muted hover:text-primary transition-all" title="Copy Code">
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={handleCopyJoinLink} className="flex items-center gap-1 px-2 py-1 hover:bg-primary-muted rounded text-text-muted hover:text-primary transition-all text-xs font-semibold" title="Copy join link">
                    <LinkIcon className="w-3.5 h-3.5" /> Join link
                  </button>
                </div>
              )}
              <Link
                to={`/course/${course.id}/schedule`}
                className="btn-secondary"
              >
                <CalendarDays className="w-4 h-4" />
                Schedule
              </Link>
              {isTeacher && (
                <Link
                  to={`/course/${course.id}/graph`}
                  id="explore-graph-btn"
                  className="btn-primary"
                >
                  <Network className="w-4 h-4" />
                  Concept Graph
                </Link>
              )}
            </div>

            {/* Quick Stats Row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4 border-t border-border">
              {(isTeacher ? [
                { label: 'Files Uploaded', value: files.length, icon: FileText },
                { label: 'Processed', value: completedFiles, icon: CheckCircle2 },
                { label: 'Students', value: students.length, icon: Users },
                { label: 'Avg Progress', value: `${avgProgress}%`, icon: TrendingUp },
              ] : [
                { label: 'My Progress', value: myProgress !== null ? `${myProgress}%` : '—', icon: TrendingUp },
              ]).map(({ label, value, icon: Icon }) => (
                <div key={label} className="flex items-center gap-3">
                  <div className="w-9 h-9 bg-primary-muted rounded-xl flex items-center justify-center">
                    <Icon className="w-4.5 h-4.5 text-primary" />
                  </div>
                  <div>
                    <p className="text-xs text-text-muted">{label}</p>
                    <p className="text-lg font-bold text-text-primary">{value}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Section tabs ──
            This page used to stack a dozen unrelated cards - stream, classwork,
            generated material, uploads, the AI pipeline, files, search, gamification,
            roster - into one scrolling column. Each of those is a separate job, so
            each now gets its own section and the page only renders the active one. */}
        <div className="flex flex-wrap gap-2 mb-6 animate-fade-up">
          {sections.map(({ key, label, icon: SectionIcon }) => (
            <button
              key={key}
              onClick={() => setActiveSection(key)}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all border ${
                activeSection === key
                  ? 'border-primary/40 bg-primary-muted text-primary'
                  : 'border-border bg-surface text-text-secondary hover:text-text-primary'
              }`}
            >
              <SectionIcon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>

        {activeSection === 'stream' && (
          <div className="space-y-6">
            {/* Class Stream - Google Classroom-style announcements feed */}
            <ClassStream courseId={idNum} isTeacher={isTeacher} />
          </div>
        )}

        {activeSection === 'classwork' && (
          <div className="space-y-6">
            {/* Assignments (Classwork) - due dates, attachments, submissions */}
            <Assignments courseId={idNum} isTeacher={isTeacher} catalogId={course?.catalog_id ?? null} />
          </div>
        )}

        {activeSection === 'study' && (
          <div className="space-y-6">
            {/* Content Generation - AI flashcards/MCQs/quizzes/study guides from KG concepts */}
            <ContentGeneration courseId={idNum} isTeacher={isTeacher} catalogId={course?.catalog_id ?? null} />
          </div>
        )}

        {activeSection === 'materials' && (
          <div className="space-y-6">
            {/* Upload (Teacher only) */}
            {isTeacher && (
              <div className="bg-surface rounded-2xl p-6 border border-border animate-fade-up">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-base font-bold text-text-primary flex items-center gap-2">
                    <Upload className="w-4.5 h-4.5 text-primary" />
                    Upload Course Materials
                  </h3>
                  {/* The "Rebuild Graph" button that used to sit here bypassed
                      coordinator approval and wrote straight into the shared graph.
                      Removed - use "Generate (AI + Review)" below, which routes
                      through review and approval. */}
                </div>
                <p className="text-text-secondary text-sm mb-4">
                  Upload PDFs, slides, or documents, then use <span className="font-semibold">Generate (AI + Review)</span> below
                  to extract concepts for review and coordinator approval.
                </p>

                {/* Course material and the course outline are handled completely
                    differently downstream, so they are chosen up front rather than
                    guessed at from the filename. Material is chunked and embedded for
                    retrieval; the outline is never embedded and is passed to concept
                    extraction as scope context. Uploading an outline as material is
                    what previously put "Credit Hours", "Code PHY" and "Halliday" into
                    the concept graph as if they were course concepts. */}
                <div className="flex gap-2 mb-3">
                  {([
                    { key: 'material', label: 'Course material', hint: 'Slides, notes, chapters' },
                    { key: 'outline', label: 'Course outline', hint: 'Syllabus / topic list' },
                  ] as const).map(({ key, label, hint }) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setUploadKind(key)}
                      className={`flex-1 text-left rounded-xl border p-3 transition-all ${
                        uploadKind === key
                          ? 'border-primary/40 bg-primary-muted'
                          : 'border-border bg-background hover:border-primary/20'
                      }`}
                    >
                      <span className="block text-xs font-bold text-text-primary">{label}</span>
                      <span className="block text-[12px] text-text-muted mt-0.5">{hint}</span>
                    </button>
                  ))}
                </div>

                <p className="text-[12px] text-text-muted mb-3">
                  {uploadKind === 'material'
                    ? 'Indexed for semantic search and used to ground generated study material and grading.'
                    : 'Not indexed for search. Used to keep extracted concepts inside the syllabus scope and consistently named.'}
                </p>

                <div className="border-2 border-dashed border-border rounded-xl p-8 text-center bg-background hover:border-primary/40 hover:bg-primary-muted/30 transition-all relative">
                  <input
                    type="file"
                    id="file-upload"
                    accept=".pdf,.docx,.pptx,.ppt,.txt"
                    onChange={handleFileUpload}
                    disabled={uploading}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                  <div className="flex flex-col items-center justify-center gap-2 pointer-events-none">
                    {uploading ? (
                      <RefreshCw className="w-10 h-10 text-primary animate-spin" />
                    ) : (
                      <div className="w-14 h-14 bg-primary-muted rounded-xl flex items-center justify-center">
                        <Upload className="w-7 h-7 text-primary" />
                      </div>
                    )}
                    <p className="text-sm font-semibold text-text-primary mt-1">
                      {uploading
                        ? 'Uploading...'
                        : `Click to browse or drag & drop — uploading as ${uploadKind === 'material' ? 'course material' : 'course outline'}`}
                    </p>
                    <p className="text-xs text-text-muted">PDF, PPT/PPTX, DOCX, TXT — up to 25MB</p>
                  </div>
                </div>
              </div>
            )}



            {/* Files Table — teacher only. Students never see the raw
                upload/processing pipeline used to build the concept graph;
                they only get the Content Search panel below. */}
            {isTeacher && (
            <div className="bg-surface rounded-2xl p-6 border border-border animate-fade-up">
              <h3 className="text-base font-bold text-text-primary mb-4 flex items-center gap-2">
                <FileText className="w-4.5 h-4.5 text-secondary" />
                Course Materials ({files.length})
              </h3>

              {files.length === 0 ? (
                <div className="text-center py-12 text-text-muted text-sm border-2 border-dashed border-border rounded-xl">
                  <EmptyStateIllustration className="w-24 h-24 mx-auto mb-2" />
                  No materials uploaded yet.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-border text-text-muted font-semibold text-xs uppercase tracking-wider">
                        <th className="py-3 px-3">Filename</th>
                        <th className="py-3 px-3">Size</th>
                        <th className="py-3 px-3">Status</th>
                        <th className="py-3 px-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border text-text-primary">
                      {files.map((file) => (
                        <tr key={file.id} className="hover:bg-background/60 transition-colors">
                          <td className="py-3.5 px-3 font-medium flex items-center gap-2">
                            <FileText className="w-4 h-4 text-text-muted shrink-0" />
                            <span className="truncate max-w-xs" title={file.filename}>{file.filename}</span>
                          </td>
                          <td className="py-3.5 px-3 text-text-secondary text-xs">
                            {(file.file_size / 1024 / 1024).toFixed(2)} MB
                          </td>
                          <td className="py-3.5 px-3">
                            <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold ${
                              file.status === 'Completed' ? 'bg-primary-muted text-primary border border-primary/20' :
                              file.status === 'Processing' ? 'bg-primary-muted text-primary border border-primary/20' :
                              file.status === 'Failed'    ? 'bg-red-50 text-red-600 border border-red-200 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/30' :
                              'bg-card text-text-secondary border border-border'
                            }`}>
                              {file.status === 'Processing' && <RefreshCw className="w-3 h-3 animate-spin" />}
                              {file.status}
                            </span>
                            {file.status === 'Completed' && file.material_kind !== 'outline' && file.rag_status && file.rag_status !== 'Completed' && (
                              <span
                                title={file.rag_status === 'Failed' ? (file.rag_error || 'Search indexing failed.') : 'Search indexing is still in progress.'}
                                className={`ml-1.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold ${
                                  file.rag_status === 'Failed'
                                    ? 'bg-red-50 text-red-600 border border-red-200 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/30'
                                    : 'bg-card text-text-secondary border border-border'
                                }`}
                              >
                                {file.rag_status === 'Failed' ? 'Not searchable' : 'Indexing…'}
                              </span>
                            )}
                          </td>
                          <td className="py-3.5 px-3 text-right space-x-1">
                            <a
                              href={`http://localhost:8000/api/files/${file.id}`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex p-1.5 bg-background hover:bg-primary-muted border border-border text-text-muted hover:text-primary rounded-lg transition-all"
                              title="Download"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </a>
                            {isTeacher && (
                              <>
                                <button
                                  onClick={() => handleReprocessFile(file.id)}
                                  className="inline-flex p-1.5 bg-background hover:bg-primary-muted border border-border hover:border-primary/30 text-text-muted hover:text-primary rounded-lg transition-all"
                                  title="Re-extract concepts"
                                >
                                  <Play className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => document.getElementById(`replace-file-input-${file.id}`)?.click()}
                                  className="inline-flex p-1.5 bg-background hover:bg-primary-muted border border-border hover:border-primary-hover text-text-muted hover:text-primary rounded-lg transition-all"
                                  title="Replace file"
                                >
                                  <RefreshCw className="w-3.5 h-3.5" />
                                </button>
                                <input
                                  type="file"
                                  id={`replace-file-input-${file.id}`}
                                  className="hidden"
                                  accept=".pdf,.docx,.pptx,.ppt,.txt"
                                  onChange={(e) => handleFileReplace(file.id, e)}
                                  disabled={uploading}
                                />
                                <button
                                  onClick={() => handleDeleteFile(file.id)}
                                  className="inline-flex p-1.5 bg-background hover:bg-red-50 border border-border hover:border-red-300 text-text-muted hover:text-red-500 dark:hover:bg-red-500/10 dark:hover:border-red-500/30 dark:hover:text-red-400 rounded-lg transition-all"
                                  title="Delete"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            )}

            {/* Content Search - tests the RAG retrieval pipeline directly from the UI */}
            <div className="bg-surface rounded-2xl p-6 border border-border animate-fade-up">
              <h3 className="text-base font-bold text-text-primary mb-1 flex items-center gap-2">
                <Search className="w-4.5 h-4.5 text-secondary" />
                Content Search
              </h3>
              <p className="text-xs text-text-muted mb-4">
                Semantic search over this course's uploaded material (text and image captions).
              </p>
              <form onSubmit={handleSearch} className="flex gap-2 mb-4">
                <input
                  type="text"
                  className="input-light flex-1"
                  placeholder="e.g. Newton's second law"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                <button type="submit" disabled={searching || !searchQuery.trim()} className="btn-primary disabled:opacity-60">
                  {searching ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                  Search
                </button>
              </form>

              {searchResults !== null && (
                searchResults.length === 0 ? (
                  <div className="text-center py-8 text-text-muted text-sm border-2 border-dashed border-border rounded-xl">
                    Nothing relevant found in the uploaded material for that query.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {searchResults.map((r, i) => (
                      <div key={i} className="bg-background rounded-xl p-4 border border-border">
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <span className="text-xs font-semibold text-primary">{r.citation}</span>
                          <span className="text-[11px] font-bold text-text-muted uppercase tracking-wider">
                            {(r.score * 100).toFixed(0)}% match
                          </span>
                        </div>
                        <p className="text-sm text-text-secondary line-clamp-3">{r.text}</p>
                      </div>
                    ))}
                  </div>
                )
              )}
            </div>
          </div>
        )}

        {activeSection === 'graph' && isTeacher && (
          <div className="space-y-6">
        {/* Graph Info - teacher/coordinator only. Students work with the
            concept graph indirectly (generated study materials, the
            Adaptive Engine's revision plan, mastery tracking) rather than
            viewing/interacting with the raw graph itself. */}
        {isTeacher && (
          <div className="bg-surface rounded-2xl p-6 border border-border animate-fade-up">
            <h3 className="text-base font-bold text-text-primary mb-3 flex items-center gap-2">
              <Network className="w-4.5 h-4.5 text-primary" />
              Concept Graph
            </h3>
            <p className="text-text-secondary text-sm leading-relaxed mb-4">
              Upload course materials and the AI will automatically extract concept nodes and prerequisite relationships into an interactive graph.
            </p>
            <Link
              to={`/course/${course.id}/graph`}
              className="flex items-center justify-center gap-2 w-full py-2.5 bg-primary-muted border border-primary/20 text-primary font-semibold rounded-xl text-sm hover:bg-primary hover:text-white transition-all"
            >
              <Network className="w-4 h-4" />
              Explore Graph
            </Link>
          </div>
        )}

        {/* Reviewed AI Pipeline (Teacher only) */}
        {isTeacher && (
          <div className="bg-surface rounded-2xl p-6 border border-border animate-fade-up">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-bold text-text-primary flex items-center gap-2">
                <Sparkles className="w-4.5 h-4.5 text-primary" />
                AI-Reviewed Concept Graph
              </h3>
              <button
                onClick={handleTriggerPipeline}
                disabled={triggeringPipeline || completedFiles === 0 || (!!latestJob && NON_TERMINAL_JOB_STATUSES.includes(latestJob.status))}
                className="btn-primary text-xs px-3.5 py-1.5"
                title="Runs OCR'd text through Kimi AI, then requires your review and coordinator approval before anything changes the graph"
              >
                {triggeringPipeline ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                Generate (AI + Review)
              </button>
            </div>
            <p className="text-text-secondary text-sm mb-4">
              Structures your uploaded material into concepts via AI, diffs it against the course's shared graph,
              and requires your confirmation and the course coordinator's approval before anything is merged.
            </p>

            {latestJob ? (
              <div className="bg-background border border-border rounded-xl p-4 flex items-center justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-text-primary flex items-center gap-2">
                    {NON_TERMINAL_JOB_STATUSES.includes(latestJob.status) && latestJob.status !== 'AwaitingTeacherReview' && (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin text-primary shrink-0" />
                    )}
                    {JOB_STATUS_LABELS[latestJob.status] || latestJob.status}
                  </p>
                  {latestJob.error_message && (
                    <p className="text-xs text-red-600 mt-1 truncate" title={latestJob.error_message}>{latestJob.error_message}</p>
                  )}
                </div>
                {latestJob.status === 'AwaitingTeacherReview' && (
                  <button
                    onClick={() => handleOpenReview(latestJob.id)}
                    disabled={loadingRevision}
                    className="shrink-0 flex items-center gap-1.5 px-3.5 py-1.5 bg-primary text-white font-semibold rounded-lg text-xs hover:bg-primary-hover transition-all disabled:opacity-50"
                  >
                    {loadingRevision ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : null}
                    Review Proposed Concepts
                  </button>
                )}
              </div>
            ) : (
              <div className="text-text-muted text-xs text-center py-4">
                <EmptyStateIllustration className="w-14 h-14 mx-auto mb-1" />
                No AI review runs yet for this course.
              </div>
            )}
          </div>
        )}

        {/* Teacher's own audit trail of draft graphs / manual edits sent for
            approval, including the coordinator's decision and notes. */}
        {isTeacher && <GraphSubmissionLog courseId={idNum} />}
          </div>
        )}

        {activeSection === 'progress' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            {/* Gamification - points, streaks, badges, leaderboard */}
            <Gamification courseId={idNum} isTeacher={isTeacher} />

            {/* Adaptive Engine - personalized revision plan (students only) */}
            {!isTeacher && <RevisionPlanCard courseId={idNum} />}

            {/* CLO/PLO attainment - the outcome-chain reporting layer (students only) */}
            {!isTeacher && <OutcomeAttainment courseId={idNum} />}
          </div>
        )}

        {activeSection === 'people' && (
          <div className="space-y-6">
            {/* Students Roster (Teacher only) */}
            {isTeacher && (
              <div className="bg-surface rounded-2xl p-6 border border-border animate-fade-up">
                <h3 className="text-base font-bold text-text-primary mb-4 flex items-center gap-2">
                  <Users className="w-4.5 h-4.5 text-secondary" />
                  Classroom Roster ({students.length})
                </h3>

                {students.length === 0 ? (
                  <div className="text-text-muted text-sm text-center py-6">
                    <EmptyStateIllustration className="w-16 h-16 mx-auto mb-1.5" />
                    No students enrolled yet.
                  </div>
                ) : (
                  <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                    {students.map((student) => (
                      <div
                        key={student.student_id}
                        className="bg-background border border-border rounded-xl p-3 flex items-center justify-between"
                      >
                        <div className="truncate min-w-0">
                          <p className="text-sm font-semibold text-text-primary truncate">{student.full_name}</p>
                          <p className="text-[12px] text-text-muted truncate">{student.email}</p>
                        </div>
                        <div className="text-right shrink-0 ml-2">
                          <p className="text-xs font-bold text-secondary">{student.progress.toFixed(0)}%</p>
                          <p className="text-[11px] text-text-muted">{student.status}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

      {/* Teacher review modal: confirm or reject the AI-proposed diff before it goes
          to the course coordinator for final approval. */}
      {reviewRevision && (
        <div className="fixed inset-0 z-50 bg-black/20 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-surface rounded-2xl shadow-hover border border-border max-w-2xl w-full max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h3 className="text-base font-bold text-text-primary flex items-center gap-2">
                <Sparkles className="w-4.5 h-4.5 text-primary" />
                Review Proposed Concepts
              </h3>
              <button onClick={() => { setReviewRevision(null); setReviewNotes(''); }} className="p-1 text-text-muted hover:text-text-primary rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-4 overflow-y-auto flex-1 space-y-3">
              <div className="flex gap-4 text-xs text-text-secondary mb-2">
                <span>{reviewRevision.diff.new_concept_count} new concept(s)</span>
                <span>{reviewRevision.diff.matched_existing_count} already existed</span>
                <span>{reviewRevision.diff.new_relationship_count} new prerequisite link(s)</span>
              </div>

              <DiffGraphPreview concepts={reviewRevision.diff.concepts} className="h-72 mb-2" />

              {reviewRevision.diff.concepts.map((concept, i) => (
                <div key={i} className="bg-background border border-border rounded-xl p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-text-primary text-sm">{concept.name}</p>
                    <span className={
                      concept.difficulty === 'Easy' ? 'badge-easy' :
                      concept.difficulty === 'Hard' ? 'badge-hard' : 'badge-medium'
                    }>{concept.difficulty}</span>
                  </div>
                  <p className="text-text-secondary text-xs mt-1.5">{concept.description}</p>
                  <p className="text-text-muted text-[12px] mt-1.5 italic">{concept.learning_outcomes}</p>
                  <div className="flex items-center justify-between mt-2 text-[12px] text-text-muted">
                    <span>Importance: {concept.importance_score}/10</span>
                    {concept.prerequisites.length > 0 && (
                      <span>Prerequisites: {concept.prerequisites.join(', ')}</span>
                    )}
                  </div>
                </div>
              ))}

              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1.5">Notes (optional)</label>
                <textarea
                  className="input-light text-sm w-full"
                  rows={2}
                  placeholder="e.g. why you're rejecting this, or anything the coordinator should know"
                  value={reviewNotes}
                  onChange={(e) => setReviewNotes(e.target.value)}
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
              <button
                onClick={() => handleTeacherDecision('reject')}
                disabled={decidingRevision}
                className="flex items-center gap-1.5 px-4 py-2 bg-red-50 border border-red-200 text-red-600 hover:bg-red-100 font-semibold rounded-xl text-sm transition-all disabled:opacity-50"
              >
                <ThumbsDown className="w-4 h-4" />
                Reject
              </button>
              <button
                onClick={() => handleTeacherDecision('confirm')}
                disabled={decidingRevision}
                className="btn-primary"
              >
                {decidingRevision ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ThumbsUp className="w-4 h-4" />}
                Confirm & Send for Approval
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
};

export default CourseDetail;
