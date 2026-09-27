import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppShell, type NavItem } from '../components/AppShell';
import { EmptyStateIllustration } from '../components/illustrations';
import { assistantService } from '../services/api';
import type { ChatMessageItem } from '../services/api';
import { timeAgo } from '../lib/time';
import { useAuth } from '../context/AuthContext';
import { getPrimaryNavItems } from '../lib/roleNav';
import { Sparkles, Send, RotateCcw, Loader2, Bot, GraduationCap, Presentation, UserCog, Network, Layers, User as UserIcon } from 'lucide-react';

// A literal "who's talking" character per role, in the app's teal theme
// (same rgb(var(--primary)) badge used everywhere else): a graduate for
// students, someone presenting at a board for teachers, and a person
// managing settings for admins.
const ROLE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  student: GraduationCap,
  teacher: Presentation,
  admin: UserCog,
  course_coordinator: Network,
  program_coordinator: Layers,
};

// Client-side placeholder used for the just-sent user message while we wait on
// the backend's reply - the POST endpoint only returns the assistant's message,
// so the user's own bubble is rendered optimistically until the round trip
// finishes (or replaced entirely by the next full history refetch).
let tempIdCounter = -1;

const AssistantPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [messages, setMessages] = useState<ChatMessageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [input, setInput] = useState('');
  const [clearing, setClearing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Same role-specific top section as the user's own dashboard, so the sidebar
  // looks identical everywhere instead of collapsing to just the global links.
  const navItems: NavItem[] = getPrimaryNavItems(user, navigate);

  const fetchHistory = async () => {
    setLoading(true);
    try {
      const data = await assistantService.getMessages();
      setMessages(data);
    } catch {
      // Silent - the page just shows the empty state until a retry succeeds.
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  const handleSend = async () => {
    const content = input.trim();
    if (!content || sending) return;

    const optimisticUser: ChatMessageItem = {
      id: tempIdCounter--,
      role: 'user',
      content,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticUser]);
    setInput('');
    setSending(true);
    try {
      const reply = await assistantService.sendMessage(content);
      setMessages((prev) => [...prev, reply]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: tempIdCounter--,
          role: 'assistant',
          content: "Sorry, something went wrong sending that message. Please try again.",
          created_at: new Date().toISOString(),
        },
      ]);
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleClear = async () => {
    if (clearing) return;
    setClearing(true);
    try {
      await assistantService.clearMessages();
      setMessages([]);
    } catch {
      // Silent - history stays as-is if the clear request failed.
    } finally {
      setClearing(false);
    }
  };

  return (
    <AppShell roleLabel="AI Assistant" logoIcon={Sparkles} navItems={navItems}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">AI Assistant</h1>
          <p className="text-text-secondary mt-1 text-sm">Ask questions about your courses, concepts, or anything else.</p>
        </div>
        {messages.length > 0 && (
          <button
            onClick={handleClear}
            disabled={clearing}
            className="btn-ghost text-sm disabled:opacity-50"
            title="Start a new conversation"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            New conversation
          </button>
        )}
      </div>

      <div className="glass-panel rounded-2xl flex flex-col h-[calc(100vh-220px)] min-h-[420px]">
        {/* Message list */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 space-y-4">
          {loading ? (
            <div className="h-full flex items-center justify-center text-sm text-text-muted">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading conversation...
            </div>
          ) : messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto">
              <EmptyStateIllustration className="w-28 h-28 mb-4" />
              <h3 className="text-lg font-bold text-text-primary mb-1.5">Ask me anything about your courses</h3>
              <p className="text-text-secondary text-sm">
                I can help explain concepts, summarize material, or answer questions about what you're studying.
              </p>
            </div>
          ) : (
            messages.map((m) => (
              <div key={m.id} className={`flex items-end gap-2 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {m.role === 'assistant' && (
                  <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0 mb-1" title="ConceptIntel Assistant">
                    <Bot className="w-4 h-4" />
                  </div>
                )}
                <div className={`max-w-[80%] sm:max-w-[70%] rounded-2xl px-4 py-2.5 ${
                  m.role === 'user'
                    ? 'bg-primary text-white rounded-br-sm'
                    : 'bg-card text-text-primary rounded-bl-sm border border-border'
                }`}
                >
                  <p className="text-sm whitespace-pre-wrap break-words">{m.content}</p>
                  <p className={`text-[11px] mt-1 ${m.role === 'user' ? 'text-white/70' : 'text-text-muted'}`}>
                    {timeAgo(m.created_at)}
                  </p>
                </div>
                {m.role === 'user' && (() => {
                  const RoleIcon = (user?.role && ROLE_ICONS[user.role]) || UserIcon;
                  return (
                    <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shrink-0 mb-1" title={user?.role}>
                      <RoleIcon className="w-4 h-4 text-white" />
                    </div>
                  );
                })()}
              </div>
            ))
          )}
          {sending && (
            <div className="flex items-end gap-2 justify-start">
              <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0 mb-1" title="ConceptIntel Assistant">
                <Bot className="w-4 h-4" />
              </div>
              <div className="max-w-[70%] rounded-2xl rounded-bl-sm px-4 py-2.5 bg-card border border-border flex items-center gap-2 text-text-muted text-sm">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Thinking...
              </div>
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="border-t border-border p-3 sm:p-4">
          <div className="flex items-end gap-2">
            <textarea
              ref={textareaRef}
              className="input-light resize-none flex-1 max-h-40"
              rows={1}
              placeholder="Type a message... (Enter to send, Shift+Enter for a new line)"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={sending}
            />
            <button
              onClick={handleSend}
              disabled={sending || !input.trim()}
              className="btn-primary shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Send"
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              <span className="hidden sm:inline">Send</span>
            </button>
          </div>
        </div>
      </div>
    </AppShell>
  );
};

export default AssistantPage;
