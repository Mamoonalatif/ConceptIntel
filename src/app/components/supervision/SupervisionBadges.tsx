import { Badge } from '../ui/badge';
import type { ContentStatus, ContentType } from '../../types/supervision';
import { contentTypeLabels, statusColors, statusLabels } from '../../types/supervision';

export function StatusBadge({ status }: { status: ContentStatus }) {
  return (
    <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${statusColors[status]}`}>
      {statusLabels[status]}
    </span>
  );
}

export function ContentTypeBadge({ type }: { type: ContentType }) {
  return <Badge variant="outline">{contentTypeLabels[type]}</Badge>;
}

export function formatDate(value: string) {
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
