import { useEffect, useState } from 'react';

import { getEpisode, listEpisodes, subscribe, type Episode } from './db';
import { batchNote, isBatchPaused, listBatch } from './batch';
import { getProgress, subscribeProgress, type Progress } from './downloads';

export function useEpisodes(): Episode[] {
  const [episodes, setEpisodes] = useState(listEpisodes);
  useEffect(() => subscribe(() => setEpisodes(listEpisodes())), []);
  return episodes;
}

export function useEpisode(id: number): Episode | null {
  const [episode, setEpisode] = useState(() => getEpisode(id));
  useEffect(() => {
    setEpisode(getEpisode(id));
    return subscribe(() => setEpisode(getEpisode(id)));
  }, [id]);
  return episode;
}

/** Live byte counts for a download, falling back to the last values saved in the database. */
export function useProgress(episode: Episode): Progress {
  const [live, setLive] = useState(() => getProgress(episode.id));
  useEffect(() => subscribeProgress(() => setLive(getProgress(episode.id))), [episode.id]);
  return live ?? { bytesWritten: episode.bytesWritten, totalBytes: episode.totalBytes };
}

/** The season-download queue and what it's waiting on, kept current. */
export function useBatch() {
  const read = () => ({ items: listBatch(), note: batchNote(), paused: isBatchPaused() });
  const [state, setState] = useState(read);
  useEffect(() => subscribe(() => setState(read())), []);
  return state;
}
