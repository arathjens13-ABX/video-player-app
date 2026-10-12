import Colors from '@/constants/Colors';

import { useColorScheme } from './useColorScheme';

export function useColors() {
  return Colors[useColorScheme()];
}
