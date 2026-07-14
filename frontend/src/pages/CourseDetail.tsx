import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { courseService, uploadService, enrollmentService, graphService } from '../services/api';
import {
  ArrowLeft, BookOpen, Upload, FileText, Trash2, RefreshCw,
  Users, CheckCircle2, AlertTriangle, Play, Network, Copy, Download,
  Zap, TrendingUp, Clock
} from 'lucide-react';

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
}

interface UploadedFile {
  id: number;
  filename: string;
  file_type: string;
  file_size: number;
  status: string;
  created_at: string;
}

interface EnrolledStudent {
  student_id: number;
  full_name: string;
  email: string;
  status: string;
  progress: number;
}

// Classroom-style banner palette — matches the accent cycling used on the
// dashboard course cards, keyed by course id so the color stays stable.
const BANNER_GRADIENTS = [
  'from-primary to-primary-hover',
  'from-secondary to-secondary-hover',
  'from-rose-500 to-rose-600',
  'from-amber-500 to-amber-600',
  'from-emerald-600 to-emerald-700',
];
const getBannerGradient = (id: number) => BANNER_GRADIENTS[Math.abs(id) % BANNER_GRADIENTS.length];

const CourseDetail: React.FC = () => {
  const { courseId } = useParams<{ courseId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const idNum = parseInt(courseId || '0');

  const [course, setCourse] = useState<Course | null>(null);
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [students, setStudents] = useState<EnrolledStudent[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const isTeacher = user?.role === 'teacher';

  const fetchData = async () => {
    try {
      setLoading(true);
      const courseData = await courseService.getDetails(idNum);
      setCourse(courseData);
      const filesData = await uploadService.getCourseFiles(idNum);
      setFiles(filesData);
      if (isTeacher) {
        const studentsData = await enrollmentService.getEnrolledStudents(idNum);
        setStudents(studentsData);
      }
    } catch (err: any) {
      setError('Failed to load course details. Ensure backend connection is active.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (idNum) fetchData();
  }, [courseId]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;
    setUploading(true);
    setError('');
    setSuccess('');
    try {
      await uploadService.uploadFile(idNum, selectedFile);
      setSuccess(`"${selectedFile.name}" uploaded. AI processing started.`);
      fetchData();
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to upload file');
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
    } catch {
      setError('Failed to delete file.');
    }
  };

  const handleReprocessFile = async (fileId: number) => {
    try {
      await uploadService.reprocessFile(fileId);
      setSuccess('Re-triggered text extraction & concept mining.');
      fetchData();
    } catch {
      setError('Failed to reprocess file.');
    }
  };

  const handleRebuildGraph = async () => {
    setRebuilding(true);
    setError('');
    setSuccess('');
    try {
      await graphService.buildGraph(idNum);
      setSuccess('Knowledge graph rebuilt successfully from uploaded content!');
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to rebuild graph.');
    } finally {
      setRebuilding(false);
    }
  };

  const handleCopyCode = () => {
    if (course?.enrollment_code) {
      navigator.clipboard.writeText(course.enrollment_code);
      setSuccess('Enrollment code copied!');
      setTimeout(() => setSuccess(''), 3000);
    }
  };

  const completedFiles = files.filter(f => f.status === 'Completed').length;
  const avgProgress = students.length
    ? Math.round(students.reduce((sum, s) => sum + s.progress, 0) / students.length)
    : 0;

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
        <RefreshCw className="w-10 h-10 text-primary animate-spin" />
        <p className="text-text-secondary text-sm">Loading course details...</p>
      </div>
    );
  }

  if (!course) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
        <AlertTriangle className="w-16 h-16 text-amber-400 mb-4" />
        <h3 className="text-xl font-bold text-text-primary mb-2">Course Not Found</h3>
        <button onClick={() => navigate(-1)} className="btn-primary mt-2">Go Back</button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-16">
      <div className="page-bg-decoration" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 relative z-10">
        {/* Back nav */}
        <button
          onClick={() => navigate(isTeacher ? '/teacher' : '/student')}
          className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-primary font-medium transition-all mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </button>

        {/* Banners */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-600 rounded-xl p-4 mb-5 text-sm flex items-center gap-2 animate-fade-in">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {success && (
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl p-4 mb-5 text-sm flex items-center gap-2 animate-fade-in">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{success}</span>
          </div>
        )}

        {/* Course Hero Banner */}
        <div className="rounded-2xl overflow-hidden border border-border shadow-card mb-6 animate-fade-up bg-surface">
          <div className={`relative px-6 sm:px-8 pt-8 pb-12 bg-gradient-to-br ${getBannerGradient(course.id)}`}>
            <span className="inline-block bg-white/20 backdrop-blur-sm text-white text-xs font-bold px-2.5 py-0.5 rounded-lg uppercase tracking-wider">
              {course.code || 'NO-CODE'}
            </span>
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
                </div>
              )}
              <Link
                to={`/course/${course.id}/graph`}
                id="explore-graph-btn"
                className="btn-primary"
              >
                <Network className="w-4 h-4" />
                Knowledge Graph
              </Link>
            </div>

            {/* Quick Stats Row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4 border-t border-border">
              {[
                { label: 'Files Uploaded', value: files.length, icon: FileText, color: 'text-primary', bg: 'bg-primary-muted' },
                { label: 'Processed', value: completedFiles, icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-50' },
                { label: 'Students', value: isTeacher ? students.length : '—', icon: Users, color: 'text-secondary', bg: 'bg-secondary-muted' },
                { label: 'Avg Progress', value: isTeacher ? `${avgProgress}%` : '—', icon: TrendingUp, color: 'text-amber-600', bg: 'bg-amber-50' },
              ].map(({ label, value, icon: Icon, color, bg }) => (
                <div key={label} className="flex items-center gap-3">
                  <div className={`w-9 h-9 ${bg} rounded-xl flex items-center justify-center`}>
                    <Icon className={`w-4.5 h-4.5 ${color}`} />
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

        {/* Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Upload + Files */}
          <div className="lg:col-span-2 space-y-6">

            {/* Upload (Teacher only) */}
            {isTeacher && (
              <div className="bg-surface rounded-2xl p-6 border border-border animate-fade-up">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-base font-bold text-text-primary flex items-center gap-2">
                    <Upload className="w-4.5 h-4.5 text-primary" />
                    Upload Course Materials
                  </h3>
                  <button
                    id="rebuild-graph-btn"
                    onClick={handleRebuildGraph}
                    disabled={rebuilding || completedFiles === 0}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 bg-amber-50 border border-amber-200 text-amber-700 hover:bg-amber-100 font-semibold rounded-lg text-xs transition-all disabled:opacity-50"
                    title="Extract concepts from all completed files"
                  >
                    {rebuilding ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                    Rebuild Graph
                  </button>
                </div>
                <p className="text-text-secondary text-sm mb-4">
                  Upload PDFs, slides, or documents. The AI will automatically extract concept nodes and prerequisite relationships.
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
                      {uploading ? 'Uploading...' : 'Click to browse or drag & drop'}
                    </p>
                    <p className="text-xs text-text-muted">PDF, PPT/PPTX, DOCX, TXT — up to 25MB</p>
                  </div>
                </div>
              </div>
            )}

            {/* Files Table */}
            <div className="bg-surface rounded-2xl p-6 border border-border animate-fade-up">
              <h3 className="text-base font-bold text-text-primary mb-4 flex items-center gap-2">
                <FileText className="w-4.5 h-4.5 text-secondary" />
                Course Materials ({files.length})
              </h3>

              {files.length === 0 ? (
                <div className="text-center py-12 text-text-muted text-sm border-2 border-dashed border-border rounded-xl">
                  <FileText className="w-10 h-10 mx-auto mb-2 text-text-muted/50" />
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
                              file.status === 'Completed' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                              file.status === 'Processing' ? 'bg-blue-50 text-blue-700 border border-blue-200' :
                              file.status === 'Failed'    ? 'bg-red-50 text-red-600 border border-red-200' :
                              'bg-gray-50 text-gray-600 border border-gray-200'
                            }`}>
                              {file.status === 'Processing' && <RefreshCw className="w-3 h-3 animate-spin" />}
                              {file.status}
                            </span>
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
                                  className="inline-flex p-1.5 bg-background hover:bg-amber-50 border border-border hover:border-amber-300 text-text-muted hover:text-amber-600 rounded-lg transition-all"
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
                                  className="inline-flex p-1.5 bg-background hover:bg-red-50 border border-border hover:border-red-300 text-text-muted hover:text-red-500 rounded-lg transition-all"
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
          </div>

          {/* Right: Sidebar cards */}
          <div className="space-y-6">
            {/* Graph Info */}
            <div className="bg-surface rounded-2xl p-6 border border-border animate-fade-up">
              <h3 className="text-base font-bold text-text-primary mb-3 flex items-center gap-2">
                <Network className="w-4.5 h-4.5 text-primary" />
                Knowledge Graph
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

            {/* Students Roster (Teacher only) */}
            {isTeacher && (
              <div className="bg-surface rounded-2xl p-6 border border-border animate-fade-up">
                <h3 className="text-base font-bold text-text-primary mb-4 flex items-center gap-2">
                  <Users className="w-4.5 h-4.5 text-secondary" />
                  Classroom Roster ({students.length})
                </h3>

                {students.length === 0 ? (
                  <p className="text-text-muted text-sm text-center py-6">No students enrolled yet.</p>
                ) : (
                  <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                    {students.map((student) => (
                      <div
                        key={student.student_id}
                        className="bg-background border border-border rounded-xl p-3 flex items-center justify-between"
                      >
                        <div className="truncate min-w-0">
                          <p className="text-sm font-semibold text-text-primary truncate">{student.full_name}</p>
                          <p className="text-[11px] text-text-muted truncate">{student.email}</p>
                        </div>
                        <div className="text-right shrink-0 ml-2">
                          <p className="text-xs font-bold text-secondary">{student.progress.toFixed(0)}%</p>
                          <p className="text-[10px] text-text-muted">{student.status}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CourseDetail;
