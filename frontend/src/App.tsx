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
  Box,
} from '@mantine/core';
import {
  IconChevronLeft,
  IconChevronRight,
  IconPlayerPlay,
  IconInfoCircle,
  IconRefresh,
  IconClock,
  IconChevronDown,
  IconChevronUp,
} from '@tabler/icons-react';
import { format, addDays, subDays } from 'date-fns';
import { ProjectFilter } from './ProjectFilter.tsx';
import {
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import {
  type Note,
  type Entry,
  fetchEntriesForDate,
  addNote,
  fetchCurrentEntry,
  runSync,
} from './api.ts';

// --- UI Components ----------------------------------------

interface SyncPanelProps {
  onSyncComplete: () => void;
}

function SyncPanel({ onSyncComplete }: SyncPanelProps) {
  const [loading, setLoading] = useState<'full' | 'recent' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);

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
    <Card withBorder shadow="sm" className="mb-4" p={0}>
      <Box
        onClick={() => setIsOpen(o => !o)}
        style={{ cursor: 'pointer' }}
        py="sm"
        px="md"
      >
        <Group justify="space-between">
          <Group>
            <IconRefresh size={20} />
            <Title order={4} m={0}>Sync Toggl Data</Title>
          </Group>
          <ActionIcon variant="subtle" color="gray">
            {isOpen ? <IconChevronUp size={20} /> : <IconChevronDown size={20} />}
          </ActionIcon>
        </Group>
      </Box>
      <Collapse in={isOpen}>
        <Box px="md" pb="md">
          <Stack gap="sm">
            <Text size="sm" c="dimmed">
              Use these actions to pull data from the Toggl API into your local
              database.
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
          </Stack>
          <Collapse in={!!message || !!error}>
            <Box mt="sm">
              {message && <Alert color="green" icon={<IconInfoCircle />}>{message}</Alert>}
              {error && <Alert color="red" icon={<IconInfoCircle />}>{error}</Alert>}
            </Box>
          </Collapse>
        </Box>
      </Collapse>
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
  const queryClient = useQueryClient();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [selectedProjects, setSelectedProjects] = useState<Set<string>>(
    new Set()
  );
  const [runningDuration, setRunningDuration] = useState('');
  const [visibleNoteInputId, setVisibleNoteInputId] = useState<number | null>(
    null
  );

  // --- Queries -------------------------------------------------
  const entriesQuery = useQuery({
    queryKey: ['entries', currentDate.toISOString().split('T')[0]],
    queryFn: () => fetchEntriesForDate(currentDate),
  });

  const currentEntryQuery = useQuery({
    queryKey: ['currentEntry'],
    queryFn: fetchCurrentEntry,
    // Refetch current entry more frequently if you want it to be near real-time
    // refetchInterval: 30000,
  });

  // --- Mutations -----------------------------------------------
  const addNoteMutation = useMutation({
    mutationFn: (variables: { entryId: number; text: string }) =>
      addNote(variables.entryId, variables.text),
    // Optimistic update logic
    onMutate: async (newNote: { entryId: number; text: string }) => {
      // Cancel any outgoing refetches (so they don't overwrite our optimistic update)
      await queryClient.cancelQueries({
        queryKey: ['entries', currentDate.toISOString().split('T')[0]],
      });

      // Snapshot the previous value
      const previousEntries = queryClient.getQueryData<Entry[]>([
        'entries',
        currentDate.toISOString().split('T')[0],
      ]);

      // Optimistically update to the new value
      if (previousEntries) {
        const newEntries = previousEntries.map((entry) => {
          if (entry.entry_id === newNote.entryId) {
            // Create a temporary note object. The server will return the real one.
            const tempNote: Note = {
              id: Date.now(), // temporary ID
              note_text: newNote.text,
              created_at: new Date().toISOString(),
            };
            return {
              ...entry,
              notes: [...entry.notes, tempNote],
            };
          }
          return entry;
        });
        queryClient.setQueryData(
          ['entries', currentDate.toISOString().split('T')[0]],
          newEntries
        );
      }

      // Return a context object with the snapshotted value
      return { previousEntries };
    },
    // If the mutation fails, use the context returned from onMutate to roll back
    onError: (_err, _newNote, context) => {
      if (context?.previousEntries) {
        queryClient.setQueryData(
          ['entries', currentDate.toISOString().split('T')[0]],
          context.previousEntries
        );
      }
      // You could also show a toast notification here
    },
    // Always refetch after error or success to ensure data is consistent
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: ['entries', currentDate.toISOString().split('T')[0]],
      });
      // also invalidate current entry if notes affect it
      queryClient.invalidateQueries({ queryKey: ['currentEntry'] });
    },
  });

  const {
    data: entries,
    isLoading: loading,
    error,
  } = entriesQuery;
  const { data: currentEntry } = currentEntryQuery;

  // Useeffect for running timer
  useEffect(() => {
    if (!currentEntry) {
      setRunningDuration('');
      return;
    }

    // Set initial value immediately and then start the timer
    setRunningDuration(formatRunningDuration(currentEntry.start));

    const timer = setInterval(() => {
      setRunningDuration(formatRunningDuration(currentEntry.start));
    }, 1000);

    // Cleanup
    return () => clearInterval(timer);
  }, [currentEntry]);

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

  const handleAddNote = (entryId: number) => {
    if (!drafts[entryId]?.trim()) return;
    addNoteMutation.mutate({ entryId, text: drafts[entryId]!.trim() });
    setDrafts({ ...drafts, [entryId]: '' });
    setVisibleNoteInputId(null); // Hide input after adding
  };

  const filteredEntries =
    entries?.filter((entry) => selectedProjects.has(entry.project_name)) ?? [];
  const totalSeconds = filteredEntries.reduce((acc, e) => acc + e.seconds, 0);

  return (
    <div style={{ padding: '2rem' }}>
      <SyncPanel onSyncComplete={() => queryClient.invalidateQueries({ queryKey: ['entries'] })} />

      <Grid>
        <Grid.Col span={{ base: 12, md: 3 }}>
          <ProjectFilter onChange={handleSelectedProjectsChange} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 9 }} role="main">
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
              {error.message}
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
            <Stack gap="xs" mt="md">
              {filteredEntries.map((entry) => (
                <Card
                  key={entry.entry_id}
                  withBorder
                  py="xs"
                  px="md"
                  onClick={() =>
                    setVisibleNoteInputId(
                      visibleNoteInputId === entry.entry_id ? null : entry.entry_id
                    )
                  }
                  style={{ cursor: 'pointer' }}
                >
                  <Group justify="space-between" align="center">
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
                    <Group gap="xs" align="center">
                      <Text size="xl" fw={600}>{formatDuration(entry.seconds)}</Text>
                    </Group>
                  </Group>

                  {entry.notes.length > 0 &&
                    <Stack
                      mt="sm"
                      className="pl-3 border-l-2 border-gray-200"
                      onClick={(e) => e.stopPropagation()}
                    >
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

                  <Collapse in={visibleNoteInputId === entry.entry_id}>
                    <Group
                      gap="xs"
                      mt="sm"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <TextInput
                        placeholder="Add a note..."
                        size="sm"
                        className="flex-1"
                        value={drafts[entry.entry_id] ?? ''}
                        onChange={(ev) =>
                          setDrafts({
                            ...drafts,
                            [entry.entry_id]: ev.currentTarget.value,
                          })
                        }
                        onKeyDown={(ev) => {
                          if (ev.key === 'Enter' && !ev.shiftKey) {
                            ev.preventDefault();
                            handleAddNote(entry.entry_id);
                          }
                        }}
                        autoFocus
                      />
                      <Button
                        size="sm"
                        variant="light"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          handleAddNote(entry.entry_id);
                        }}
                        disabled={
                          !drafts[entry.entry_id]?.trim() ||
                          addNoteMutation.isPending
                        }
                      >
                        {addNoteMutation.isPending &&
                          addNoteMutation.variables?.entryId === entry.entry_id
                          ? 'Adding...'
                          : 'Add'}
                      </Button>
                      <Button
                        size="sm"
                        variant="subtle"
                        color="gray"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          setVisibleNoteInputId(null);
                        }}
                      >
                        Cancel
                      </Button>
                    </Group>
                  </Collapse>
                </Card>
              ))}
            </Stack>
          )}
        </Grid.Col>
      </Grid>
    </div>
  );
}