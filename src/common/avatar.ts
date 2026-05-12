const animeAvatarBackgrounds = ['b6e3f4', 'c0aede', 'd1d4f9', 'ffd5dc', 'ffdfbf'];

export function getAnimeAvatar(seed: string) {
  const normalizedSeed = seed.trim().toLowerCase();
  return `https://api.dicebear.com/7.x/lorelei/svg?seed=${encodeURIComponent(normalizedSeed)}&backgroundColor=${animeAvatarBackgrounds.join(',')}`;
}

export function getUserAvatarSeed(user: { id?: string; email?: string | null }) {
  return user.email || user.id || 'qikagenda-user';
}
