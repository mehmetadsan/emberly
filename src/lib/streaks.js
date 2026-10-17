export function streakFromDates(dates, today = new Date().toISOString().slice(0, 10)) {
  const completed = new Set(dates);
  const cursor = new Date(`${today}T12:00:00Z`);
  if (!completed.has(today)) cursor.setUTCDate(cursor.getUTCDate() - 1);
  let streak = 0;
  while (completed.has(cursor.toISOString().slice(0, 10))) {
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}

export function habitStreak(logs, habitId, userId) {
  return streakFromDates(
    logs.filter((log) => log.habit_id === habitId && log.user_id === userId && log.completed).map((log) => log.date),
  );
}

export function readingStreak(logs, studentId) {
  return streakFromDates(logs.filter((log) => log.student_id === studentId).map((log) => log.date));
}
