export function StreakBadge({ streak }) {
  const tone = streak >= 30 ? 'streak-hot' : streak >= 7 ? 'streak-warm' : 'streak-mild';
  return <span className={`streak-badge ${tone}`} title={`${streak} day streak`}>🔥 {streak}</span>;
}
