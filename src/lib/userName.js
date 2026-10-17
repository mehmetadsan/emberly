export function displayName(user, profile) {
  return profile?.display_name?.trim() || user?.user_metadata?.display_name?.trim() ||
    user?.user_metadata?.full_name?.trim() || user?.email?.split('@')[0] || 'Friend';
}

export function firstName(name) {
  return name.trim().split(/\s+/)[0] || 'Friend';
}

export function todayString() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
}
