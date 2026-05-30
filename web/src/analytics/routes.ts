import type { ShareRouteType } from './types';

export function getShareRouteTypeFromPath(pathname: string): ShareRouteType {
  return pathname.startsWith('/s/') ? 'slug' : 'share';
}
