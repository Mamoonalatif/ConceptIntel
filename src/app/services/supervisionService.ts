import { authHeaders } from './authService';
import type {
  AiContent,
  ContentBody,
  ContentDetail,
  ContentStatus,
  ContentType,
  SupervisionStats,
  AuditLogEntry,
} from '../types/supervision';

const API_BASE = import.meta.env.VITE_API_URL ?? '/api';

async function handleResponse<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = (data as { detail?: unknown }).detail;
    const message = typeof detail === 'string' ? detail : 'Request failed';
    throw new Error(message);
  }
  return data as T;
}

export const supervisionService = {
  async getStats(): Promise<SupervisionStats> {
    const res = await fetch(`${API_BASE}/supervision/stats`, { headers: authHeaders() });
    return handleResponse(res);
  },

  async listContent(params?: {
    status?: ContentStatus;
    type?: ContentType;
    course_id?: string;
  }): Promise<AiContent[]> {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.type) query.set('type', params.type);
    if (params?.course_id) query.set('course_id', params.course_id);
    const qs = query.toString();
    const res = await fetch(`${API_BASE}/supervision/content${qs ? `?${qs}` : ''}`, {
      headers: authHeaders(),
    });
    return handleResponse(res);
  },

  async getContent(id: string): Promise<ContentDetail> {
    const res = await fetch(`${API_BASE}/supervision/content/${id}`, { headers: authHeaders() });
    return handleResponse(res);
  },

  async editContent(
    id: string,
    payload: { title?: string; body?: ContentBody; concept_tags?: string[]; edit_note?: string }
  ): Promise<AiContent> {
    const res = await fetch(`${API_BASE}/supervision/content/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(payload),
    });
    return handleResponse(res);
  },

  async approve(id: string, comment?: string): Promise<AiContent> {
    const res = await fetch(`${API_BASE}/supervision/content/${id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ comment }),
    });
    return handleResponse(res);
  },

  async reject(id: string, reason: string): Promise<AiContent> {
    const res = await fetch(`${API_BASE}/supervision/content/${id}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ reason }),
    });
    return handleResponse(res);
  },

  async regenerate(id: string, instructions?: string): Promise<AiContent> {
    const res = await fetch(`${API_BASE}/supervision/content/${id}/regenerate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ instructions }),
    });
    return handleResponse(res);
  },

  async getAuditLogs(limit = 50): Promise<AuditLogEntry[]> {
    const res = await fetch(`${API_BASE}/supervision/audit-logs?limit=${limit}`, {
      headers: authHeaders(),
    });
    return handleResponse(res);
  },

  async getStudentApprovedContent(params?: {
    course_id?: string;
    type?: ContentType;
  }): Promise<AiContent[]> {
    const query = new URLSearchParams();
    if (params?.course_id) query.set('course_id', params.course_id);
    if (params?.type) query.set('type', params.type);
    const qs = query.toString();
    const res = await fetch(`${API_BASE}/supervision/student/content${qs ? `?${qs}` : ''}`, {
      headers: authHeaders(),
    });
    return handleResponse(res);
  },

  async seedDemo(): Promise<{ seeded: number }> {
    const res = await fetch(`${API_BASE}/supervision/seed`, {
      method: 'POST',
      headers: authHeaders(),
    });
    return handleResponse(res);
  },
};
