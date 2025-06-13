import { useEffect, useState } from 'react';
import { Card, Text, Group, Button, TextInput, Loader, Stack, Title, ActionIcon } from '@mantine/core';
import { IconChevronLeft, IconChevronRight, IconCalendar } from '@tabler/icons-react';
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

// --- Fetch helpers ----------------------------------------
async function fetchEntriesForDate(date: Date): Promise<Entry[]> {
  const { startIso, endIso } = getDateWindowUTC(date, 4);
  const r = await fetch(
    `/api/time_entries?start_iso=${encodeURIComponent(startIso)}&end_iso=${encodeURIComponent(endIso)}`
  );
  if (!r.ok) {
    throw new Error(`HTTP ${r.status}: ${r.statusText}`);
  }
  return r.json();
}

async function addNote(entryId: number, text: string) {
  const response = await fetch('/api/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entry_id: entryId, note_text: text }),
  });
  if (!response.ok) {
    throw new Error('Failed to add note');
  }
}

// --- Helper functions ----------------------------------------
function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

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
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch entries whenever currentDate changes
  useEffect(() => {
    const loadEntries = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await fetchEntriesForDate(currentDate);
        setEntries(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load entries');
        setEntries([]);
      } finally {
        setLoading(false);
      }
    };

    loadEntries();
  }, [currentDate]);

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
          <Loader />
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