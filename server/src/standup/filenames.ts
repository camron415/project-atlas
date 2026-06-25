export function todayDatePrefix(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function standupPrepFilenameForToday(date = new Date()): string {
  return `${todayDatePrefix(date)}-standup-prep.md`;
}

export function standupAgendaFilenameForToday(date = new Date()): string {
  return `${todayDatePrefix(date)}-standup-agenda.md`;
}

export function standupDecisionsFilenameForToday(date = new Date()): string {
  return `${todayDatePrefix(date)}-standup-decisions.md`;
}

/** @deprecated Use standupPrepFilenameForToday */
export function managerFilenameForToday(date = new Date()): string {
  return standupPrepFilenameForToday(date);
}
