export type ContentType =
  | 'quiz'
  | 'assignment'
  | 'flashcard'
  | 'study_guide'
  | 'lecture_note'
  | 'concept_map';

export type ContentStatus = 'pending_review' | 'approved' | 'rejected' | 'draft';

export type ApprovalAction = 'approved' | 'rejected' | 'regenerated' | 'edited';

export interface ContentBody {
  summary?: string;
  questions?: Array<{ question: string; options?: string[]; answer?: string }>;
  instructions?: string;
  cards?: Array<{ front: string; back: string }>;
  sections?: Array<{ heading: string; content: string }>;
  ai_confidence?: number;
  ai_notes?: string;
}

export interface AiContent {
  id: string;
  course_id: string;
  course_name: string;
  title: string;
  content_type: ContentType;
  subject: string;
  concept_tags: string[];
  body: ContentBody;
  status: ContentStatus;
  version: number;
  teacher_id: string;
  teacher_name: string;
  reviewed_by_id: string | null;
  reviewed_by_name: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContentRevision {
  id: string;
  content_id: string;
  version: number;
  title: string;
  body: ContentBody;
  edited_by_id: string;
  edited_by_name: string;
  edit_note: string | null;
  created_at: string;
}

export interface ApprovalRecord {
  id: string;
  content_id: string;
  action: ApprovalAction;
  reviewer_id: string;
  reviewer_name: string;
  reviewer_role: string;
  comment: string | null;
  previous_status: string;
  new_status: string;
  created_at: string;
}

export interface AuditLogEntry {
  id: string;
  actor_id: string;
  actor_name: string;
  actor_role: string;
  action: string;
  resource_type: string;
  resource_id: string;
  details: Record<string, unknown>;
  created_at: string;
}

export interface ContentDetail extends AiContent {
  revisions: ContentRevision[];
  approvals: ApprovalRecord[];
}

export interface SupervisionStats {
  pending_review: number;
  approved: number;
  rejected: number;
  total: number;
}

export const contentTypeLabels: Record<ContentType, string> = {
  quiz: 'Quiz',
  assignment: 'Assignment',
  flashcard: 'Flashcards',
  study_guide: 'Study Guide',
  lecture_note: 'Lecture Notes',
  concept_map: 'Concept Map',
};

export const statusLabels: Record<ContentStatus, string> = {
  pending_review: 'Pending Review',
  approved: 'Approved',
  rejected: 'Rejected',
  draft: 'Draft',
};

export const statusColors: Record<ContentStatus, string> = {
  pending_review: 'bg-[#F59E0B]/10 text-[#F59E0B]',
  approved: 'bg-[#22C55E]/10 text-[#22C55E]',
  rejected: 'bg-[#EF4444]/10 text-[#EF4444]',
  draft: 'bg-muted text-muted-foreground',
};
