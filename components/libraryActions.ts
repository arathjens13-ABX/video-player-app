import { router } from 'expo-router';
import { Alert } from 'react-native';

import { batch, updateEpisode, type Episode } from '@/lib/db';
import { remove } from '@/lib/downloads';

export function playEpisode(id: number) {
  router.push({ pathname: '/player/[id]', params: { id } });
}

/** Long-press menu for one episode. */
export function episodeActions(e: Episode) {
  Alert.alert(e.title, e.show, [
    { text: 'Edit details', onPress: () => router.push({ pathname: '/episode-form', params: { id: e.id } }) },
    {
      text: e.watched ? 'Mark as unwatched' : 'Mark as watched',
      onPress: () => updateEpisode(e.id, { watched: e.watched ? 0 : 1, positionSec: 0 }),
    },
    {
      text: 'Delete',
      style: 'destructive',
      onPress: () =>
        Alert.alert('Delete this video?', 'The file will be removed from your phone.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: () => remove(e.id) },
        ]),
    },
    { text: 'Cancel', style: 'cancel' },
  ]);
}

/** The ••• menu for a whole show. `onDeletedAll` runs after the show is gone (e.g. to leave its page). */
export function showActions(show: string, list: Episode[], onDeletedAll?: () => void) {
  const unwatched = list.filter((e) => !e.watched).length;
  const watched = list.length - unwatched;
  Alert.alert(show, `${list.length} downloaded episode${list.length === 1 ? '' : 's'}`, [
    {
      text: unwatched > 0 ? 'Mark all as watched' : 'Mark all as unwatched',
      onPress: () => batch(() => list.forEach((e) => updateEpisode(e.id, { watched: unwatched > 0 ? 1 : 0, positionSec: 0 }))),
    },
    ...(watched > 0
      ? [
          {
            text: `Delete ${watched} watched`,
            style: 'destructive' as const,
            onPress: () =>
              Alert.alert('Delete watched episodes?', `${watched} video${watched === 1 ? '' : 's'} will be removed from your phone.`, [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete',
                  style: 'destructive',
                  onPress: () => {
                    batch(() => list.filter((e) => e.watched).forEach((e) => remove(e.id)));
                    if (unwatched === 0) onDeletedAll?.();
                  },
                },
              ]),
          },
        ]
      : []),
    {
      text: 'Delete whole show',
      style: 'destructive',
      onPress: () =>
        Alert.alert(`Delete all of ${show}?`, `${list.length} video${list.length === 1 ? '' : 's'} will be removed from your phone.`, [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () => {
              batch(() => list.forEach((e) => remove(e.id)));
              onDeletedAll?.();
            },
          },
        ]),
    },
    { text: 'Cancel', style: 'cancel' },
  ]);
}
