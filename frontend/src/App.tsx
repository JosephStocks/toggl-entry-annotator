import {
  useState,
  useEffect,
  useCallback,
} from 'react';
import {
  Card,
  Text,
  Group,
  Button,
  TextInput,
  Loader,
  Stack,
  Title,
  ActionIcon,
  Collapse,
  Alert,
} from '@mantine/core';
import {
  IconChevronLeft,
  IconChevronRight,
  IconCalendar,
  IconPlayerPlay,
  IconInfoCircle,
  IconRefresh,
  IconClock,
} from '@tabler/icons-react';
import { format, addDays, subDays } from 'date-fns';
import { getDateWindowUTC } from './utils/time.ts';

// --- Types mirroring your API ------------------------------------
type Note = { id: number; note_text: string; created_at: string };
type Entry = {
  entry_id: number;
  description: string;
  project_name: string;
  seconds: number;
  start: string;
  notes: Note[];
};
// Toggl API v9 returns a slightly different shape for the current entry
type CurrentEntry = {
  id: number;
  description: string;
  project_name: string;
  start: string;
  duration: number; // is negative
  project_id: number;
};

type SyncResult = {
  ok: boolean;
  records_synced: number;
  message: string;
};

// --- API Helpers ----------------------------------------
const API_BASE = '/api';

async function fetchApi<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${url}`, options);
  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `HTTP ${response.status} ${response.statusText}: ${errorBody}`
    );
  }
  // Handle cases where response might be empty (e.g., 204 No Content for current entry)
  if (response.status === 204) {
    return null as T;
  }
  return response.json();
}

// --- Component-specific fetchers -------------------------
const fetchEntriesForDate = (date: Date) => {
  const { startIso, endIso } = getDateWindowUTC(date, 4);
  return fetchApi<Entry[]>(
    `/time_entries?start_iso=${encodeURIComponent(
      startIso
    )}&end_iso=${encodeURIComponent(endIso)}`
  );
};

const addNote = (entryId: number, text: string) =>
  fetchApi('/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entry_id: entryId, note_text: text }),
  });

const fetchCurrentEntry = () => fetchApi<CurrentEntry | null>('/sync/current');

const runSync = (type: 'full' | 'recent') =>
  fetchApi<SyncResult>(`/sync/${type}`, { method: 'POST' });


// --- UI Components ----------------------------------------

interface SyncPanelProps {
  onSyncComplete: () => void;
}

function SyncPanel({ onSyncComplete }: SyncPanelProps) {
  const [loading, setLoading] = useState<'full' | 'recent' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSync = async (type: 'full' | 'recent') => {
    setLoading(type);
    setMessage(null);
    setError(null);
    try {
      const result = await runSync(type);
      setMessage(result.message);
      onSyncComplete();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync failed');
    } finally {
      setLoading(null);
    }
  };

  return (
    <Card withBorder shadow="sm" className="mb-4">
      <Stack gap="sm">
        <Group>
          <IconRefresh size={20} />
          <Title order={4}>Sync Toggl Data</Title>
        </Group>
        <Text size="sm" c="dimmed">
          Use these actions to pull data from the Toggl API into your local database.
        </Text>
        <Group>
          <Button
            onClick={() => handleSync('recent')}
            loading={loading === 'recent'}
            disabled={!!loading}
            variant="light"
            leftSection={<IconClock size={16} />}
          >
            Sync Recent (2 days)
          </Button>
          <Button
            onClick={() => handleSync('full')}
            loading={loading === 'full'}
            disabled={!!loading}
            color="gray"
            variant="outline"
          >
            Run Full Sync
          </Button>
        </Group>
        <Collapse in={!!message || !!error}>
          {message && <Alert color="green" icon={<IconInfoCircle />}>{message}</Alert>}
          {error && <Alert color="red" icon={<IconInfoCircle />}>{error}</Alert>}
        </Collapse>
      </Stack>
    </Card>
  );
}


// --- Helper functions ----------------------------------------
function formatRunningDuration(start: string): string {
  const ms = new Date().getTime() - new Date(start).getTime();
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const p = (n: number) => n.toString().padStart(2, '0');

  if (hours > 0) {
    return `${hours}:${p(minutes)}:${p(seconds)}`;
  }
  return `${p(minutes)}:${p(seconds)}`;
}

function formatDuration(seconds: number): string {
  const s = Math.abs(seconds); // use absolute for running timers
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function isToday(date: Date): boolean {
  const today = new Date();
  return date.toDateString() === today.toDateString();
}

// -----------------------------------------------------------------

export default function App() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [currentEntry, setCurrentEntry] = useState<CurrentEntry | null>(null);
  const [runningDuration, setRunningDuration] = useState('');
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadEntries = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [daily, current] = await Promise.all([
        fetchEntriesForDate(currentDate),
        fetchCurrentEntry(),
      ]);
      setEntries(daily);
      setCurrentEntry(current);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load entries');
      setEntries([]);
      setCurrentEntry(null);
    } finally {
      setLoading(false);
    }
  }, [currentDate]);

  // Useeffect for initial load and for running timer
  useEffect(() => {
    loadEntries();

    if (!currentEntry) return;

    const timer = setInterval(() => {
      setRunningDuration(formatRunningDuration(currentEntry.start));
    }, 1000);

    // Cleanup
    return () => clearInterval(timer);
  }, [loadEntries, currentEntry]);

  const handlePreviousDay = () => {
    setCurrentDate(prev => subDays(prev, 1));
  };

  const handleNextDay = () => {
    setCurrentDate(prev => addDays(prev, 1));
  };

  const handleToday = () => {
    setCurrentDate(new Date());
  };

  const handleAddNote = async (entryId: number) => {
    const text = drafts[entryId]?.trim();
    if (!text) return;

    try {
      await addNote(entryId, text);
      setDrafts({ ...drafts, [entryId]: '' });
      // Refresh entries to show the new note
      const refreshedEntries = await fetchEntriesForDate(currentDate);
      setEntries(refreshedEntries);
    } catch (err) {
      setError('Failed to add note');
    }
  };

  // Calculate total time for the day
  const totalSeconds = entries?.reduce((sum, entry) => sum + entry.seconds, 0) || 0;

  return (
    <Stack className="max-w-2xl mx-auto p-4">
      {/* Sync Panel */}
      <SyncPanel onSyncComplete={loadEntries} />

      {/* Current Running Timer */}
      {currentEntry && (
        <Card withBorder shadow="sm" className="mb-4 bg-blue-50 border-blue-200">
          <Group>
            <IconPlayerPlay size={24} className="text-blue-500" />
            <Stack gap={0}>
              <Text fw={600}>{currentEntry.description || <span className="italic">No description</span>}</Text>
              <Group>
                <Text size="sm" c="dimmed">{currentEntry.project_name || 'No Project'}</Text>
                <Text size="sm" c="dimmed">•</Text>
                <Text size="sm" c="blue" fw={500}>
                  {runningDuration}
                </Text>
              </Group>
            </Stack>
          </Group>
        </Card>
      )}

      {/* Date Navigation Header */}
      <Card shadow="sm" withBorder className="mb-4">
        <Group justify="space-between" align="center">
          <ActionIcon
            variant="subtle"
            size="lg"
            onClick={handlePreviousDay}
            aria-label="Previous day"
          >
            <IconChevronLeft size={20} />
          </ActionIcon>

          <Stack align="center" gap="xs">
            <Group gap="xs" align="center">
              <IconCalendar size={18} />
              <Title order={3}>
                {format(currentDate, 'EEEE, MMMM d, yyyy')}
              </Title>
            </Group>

            {!isToday(currentDate) && (
              <Button variant="subtle" size="xs" onClick={handleToday}>
                Go to Today
              </Button>
            )}

            {entries && entries.length > 0 && (
              <Text size="sm" c="dimmed">
                Total: {formatDuration(totalSeconds)} ({entries.length} entries)
              </Text>
            )}
          </Stack>

          <ActionIcon
            variant="subtle"
            size="lg"
            onClick={handleNextDay}
            aria-label="Next day"
            disabled={isToday(currentDate)} // Prevent going beyond today
          >
            <IconChevronRight size={20} />
          </ActionIcon>
        </Group>
      </Card>

      {/* Error State */}
      {error && (
        <Card shadow="sm" withBorder className="mb-4 border-red-200">
          <Text c="red" size="sm">{error}</Text>
        </Card>
      )}

      {/* Loading State */}
      {loading && (
        <div className="flex justify-center py-8">
          <Loader role="status" />
        </div>
      )}

      {/* Empty State */}
      {!loading && entries && entries.length === 0 && (
        <Card shadow="sm" withBorder className="text-center py-8">
          <Text c="dimmed">
            No time entries found for {format(currentDate, 'MMMM d, yyyy')}
          </Text>
        </Card>
      )}

      {/* Time Entries */}
      {!loading && entries && entries.length > 0 && (
        <Stack>
          {entries.map((entry) => (
            <Card key={entry.entry_id} shadow="sm" withBorder className="mb-4">
              <Group justify="space-between" align="flex-start" mb="sm">
                <div className="flex-1">
                  <Text fw={600} className="mb-1">{entry.description}</Text>
                  <Group gap="xs">
                    <Text size="sm" c="dimmed">{entry.project_name}</Text>
                    <Text size="sm" c="dimmed">•</Text>
                    <Text size="sm" c="dimmed">{formatDuration(entry.seconds)}</Text>
                    <Text size="sm" c="dimmed">•</Text>
                    <Text size="sm" c="dimmed">
                      {format(new Date(entry.start), 'h:mm a')}
                    </Text>
                  </Group>
                </div>
              </Group>

              {/* Notes Section */}
              <Stack mt="sm" className="pl-3 border-l-2 border-gray-200">
                {entry.notes.map((note) => (
                  <div key={note.id} className="bg-gray-50 p-2 rounded text-sm">
                    <Text size="sm">{note.note_text}</Text>
                    <Text size="xs" c="dimmed" mt="xs">
                      {format(new Date(note.created_at), 'MMM d, h:mm a')}
                    </Text>
                  </div>
                ))}

                {/* Add Note Form */}
                <Group gap="xs" mt="xs">
                  <TextInput
                    placeholder="Add a note..."
                    size="sm"
                    className="flex-1"
                    value={drafts[entry.entry_id] ?? ''}
                    onChange={(ev) =>
                      setDrafts({ ...drafts, [entry.entry_id]: ev.currentTarget.value })
                    }
                    onKeyDown={(ev) => {
                      if (ev.key === 'Enter' && !ev.shiftKey) {
                        ev.preventDefault();
                        handleAddNote(entry.entry_id);
                      }
                    }}
                  />
                  <Button
                    size="sm"
                    variant="light"
                    onClick={() => handleAddNote(entry.entry_id)}
                    disabled={!drafts[entry.entry_id]?.trim()}
                  >
                    Add
                  </Button>
                </Group>
              </Stack>
            </Card>
          ))}
        </Stack>
      )}
    </Stack>
  );
}