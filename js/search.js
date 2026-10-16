const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Returns a function that scores a video against the query. 0 means no match.
// Every word must appear in the title, description, or channel name.
// Title matches weigh most, then channel, then description.
// Bonuses: whole-word title match, the full phrase in the title or description, an exact title.
export function scorer(query) {
  const phrase = query.toLowerCase().trim().replace(/\s+/g, ' ');
  const words = phrase.split(' ').filter(Boolean);
  const wholeWord = words.map((w) => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(w)}($|[^\\p{L}\\p{N}])`, 'u'));

  return (video, channelTitle) => {
    if (!words.length) return 1;
    const title = video.title.toLowerCase();
    const description = video.description.toLowerCase();
    const channel = channelTitle.toLowerCase();
    let score = 0;
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (title.includes(w)) score += wholeWord[i].test(title) ? 15 : 10;
      else if (channel.includes(w)) score += 6;
      else if (description.includes(w)) score += 2;
      else return 0;
    }
    if (title === phrase) score += 100;
    else if (words.length > 1 && title.includes(phrase)) score += 50;
    else if (words.length > 1 && description.includes(phrase)) score += 10;
    return score;
  };
}

// Private and deleted videos stay in a channel's upload list but cannot be watched.
// Older saved videos have no privacy field, so the placeholder titles YouTube gives them are checked too.
export const isUnavailable = (video) =>
  video.privacy === 'private' || video.title === 'Private video' || video.title === 'Deleted video';
