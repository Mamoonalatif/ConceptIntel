import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { BookOpen, Users, BarChart3 } from 'lucide-react';
import { Card } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { courseCatalogService } from '../services/courseService';
import { MOCK_USER_IDS } from '../config/mockUsers';
import type { CourseCatalogEntry } from '../types/course';

/**
 * Course Coordinator's read-only overview. A Coordinator supervises the
 * course(s) they're assigned to, but doesn't own catalog editing or teach
 * their own classes — this is purely informational until a future module
 * adds combined statistics across every teacher's offering of the course.
 */
export function CourseCoordinatorOverviewPage() {
  const [assigned, setAssigned] = useState<CourseCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    courseCatalogService
      .getAll()
      .then((all) => setAssigned(all.filter((c) => c.coordinatorId === MOCK_USER_IDS.coordinator)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 md:px-6 py-8">
        <p className="text-muted-foreground">Loading your assigned course(s)…</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 md:px-6 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Course Supervision</h1>
        <p className="text-muted-foreground mt-1">
          You supervise the course(s) below across every Teacher's section of it
        </p>
      </div>

      {assigned.length === 0 ? (
        <Card className="p-12 text-center bg-card/50">
          <BookOpen className="w-16 h-16 mx-auto mb-4 text-muted-foreground/40" />
          <h2 className="text-xl font-semibold mb-2">No course assigned yet</h2>
          <p className="text-muted-foreground">
            An HOD/Admin assigns a Course Coordinator to a specific course in the catalog.
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {assigned.map((entry, i) => (
            <motion.div key={entry.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
              <Card className="p-6 bg-card/50 backdrop-blur-sm">
                <div className="flex items-start gap-4 mb-4">
                  <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                    <BookOpen className="w-6 h-6 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold">{entry.name}</h3>
                    <div className="flex flex-wrap gap-2 mt-2">
                      <Badge variant="outline" className="font-mono">{entry.code}</Badge>
                    </div>
                  </div>
                </div>

                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="p-4 rounded-xl bg-muted/20 border border-border flex items-center gap-3">
                    <Users className="w-5 h-5 text-muted-foreground" />
                    <div>
                      <p className="text-sm text-muted-foreground">Teacher Sections</p>
                      <p className="font-semibold">Combined view coming soon</p>
                    </div>
                  </div>
                  <div className="p-4 rounded-xl bg-muted/20 border border-border flex items-center gap-3">
                    <BarChart3 className="w-5 h-5 text-muted-foreground" />
                    <div>
                      <p className="text-sm text-muted-foreground">Combined Statistics</p>
                      <p className="font-semibold">Coming soon</p>
                    </div>
                  </div>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
