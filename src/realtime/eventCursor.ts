const CURSOR_PREFIX = 'qgents.project-events.cursor.'

export interface EventCursorStore {
  get(projectId: string): string | null
  set(projectId: string, eventId: string): void
  clear(projectId: string): void
}

export class MemoryEventCursorStore implements EventCursorStore {
  private readonly cursors = new Map<string, string>()

  get(projectId: string): string | null {
    return this.cursors.get(projectId) ?? null
  }

  set(projectId: string, eventId: string): void {
    this.cursors.set(projectId, eventId)
  }

  clear(projectId: string): void {
    this.cursors.delete(projectId)
  }
}

export const browserEventCursorStore: EventCursorStore = {
  get(projectId) {
    try {
      return window.localStorage.getItem(`${CURSOR_PREFIX}${projectId}`)
    } catch {
      return null
    }
  },
  set(projectId, eventId) {
    try {
      window.localStorage.setItem(`${CURSOR_PREFIX}${projectId}`, eventId)
    } catch {
      // A storage quota or privacy error must not stop the live connection.
    }
  },
  clear(projectId) {
    try {
      window.localStorage.removeItem(`${CURSOR_PREFIX}${projectId}`)
    } catch {
      // A storage quota or privacy error must not stop the live connection.
    }
  },
}
