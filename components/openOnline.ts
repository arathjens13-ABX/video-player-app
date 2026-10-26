import { router } from 'expo-router';

/** Opens a show's page in the app; episode links ("Latest Release") resolve to their show there. */
export function openOnline(url: string, title?: string) {
  router.push({ pathname: '/series', params: { url, ...(title ? { title } : {}) } });
}
