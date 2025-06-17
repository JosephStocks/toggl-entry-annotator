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
  Grid,
} from '@mantine/core';
import {
  IconChevronLeft,
  IconChevronRight,
  IconPlayerPlay,
  IconInfoCircle,
  IconRefresh,
  IconClock,
} from '@tabler/icons-react';
import { format, addDays, subDays } from 'date-fns';
import { getDateWindowUTC } from './utils/time.ts';
import { ProjectFilter } from './ProjectFilter.tsx';

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
  const [selectedProjects, setSelectedProjects] = useState<Set<string>>(new Set());

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

  const handleSelectedProjectsChange = useCallback((projects: Set<string>) => {
    setSelectedProjects(projects);
  }, []);

  const handleAddNote = async (entryId: number) => {
    if (!drafts[entryId]?.trim()) return;

    try {
      await addNote(entryId, drafts[entryId]?.trim());
      setDrafts({ ...drafts, [entryId]: '' });
      // Refetch after adding
      loadEntries();
    } catch (err) {
      setError('Failed to add note');
    }
  };

  const filteredEntries = entries?.filter(entry => selectedProjects.has(entry.project_name)) ?? [];
  const totalSeconds = filteredEntries.reduce((acc, e) => acc + e.seconds, 0);

  return (
    <div style={{ padding: '2rem' }}>
      <SyncPanel onSyncComplete={loadEntries} />

      <Grid>
        <Grid.Col span={3}>
          <ProjectFilter onChange={handleSelectedProjectsChange} />
        </Grid.Col>
        <Grid.Col span={9} role="main">
          {isToday(currentDate) && currentEntry && (
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

          <Group justify="space-between" align="center" mb="md">
            <ActionIcon
              variant="subtle"
              size="lg"
              onClick={handlePreviousDay}
              aria-label="Previous day"
            >
              <IconChevronLeft size={20} />
            </ActionIcon>

            <Stack align="center" gap="xs">
              <Title order={3}>
                {format(currentDate, 'EEEE, MMMM d, yyyy')}
              </Title>

              {!isToday(currentDate) && (
                <Button variant="subtle" size="xs" onClick={handleToday}>
                  Go to Today
                </Button>
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

          <Group justify="flex-end">
            {entries && entries.length > 0 && (
              <Text size="sm" c="dimmed">
                Total: {formatDuration(totalSeconds)} ({filteredEntries.length} entries)
              </Text>
            )}
          </Group>

          {error && (
            <Alert color="red" title="Error">
              {error}
            </Alert>
          )}

          {loading && (
            <Group justify="center" my="xl">
              <Loader />
            </Group>
          )}

          {!loading && !error && filteredEntries.length === 0 && (
            <Text c="dimmed" ta="center" my="xl">
              No time entries found for this day.
            </Text>
          )}

          {!loading && !error && filteredEntries.length > 0 && (
            <Stack gap="sm" mt="md">
              {filteredEntries.map((entry) => (
                <Card key={entry.entry_id} withBorder>
                  <Group justify="space-between" align="flex-start" >
                    <div className="flex-1">
                      <Text fw={600} className="mb-1">{entry.description || <span style={{ color: 'gray', fontStyle: 'italic' }}>No description</span>}</Text>
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
                    <Text size="xl" fw={600}>{formatDuration(entry.seconds)}</Text>
                  </Group>

                  {entry.notes.length > 0 &&
                    <Stack mt="sm" className="pl-3 border-l-2 border-gray-200">
                      {entry.notes.map((note) => (
                        <div key={note.id} className="bg-gray-50 p-2 rounded text-sm">
                          <Text size="sm">{note.note_text}</Text>
                          <Text size="xs" c="dimmed" mt="xs">
                            {format(new Date(note.created_at), 'MMM d, h:mm a')}
                          </Text>
                        </div>
                      ))}
                    </Stack>
                  }

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
                </Card>
              ))}
            </Stack>
          )}
        </Grid.Col>
      </Grid>
    </div>
  );
}