export type ShareRouteType = 'share' | 'slug';

export interface ShareContextProperties {
  share_route_type: ShareRouteType;
  link_type?: 'ALBUM' | 'INDIVIDUAL';
  asset_count?: number;
  allow_upload?: boolean;
  allow_download?: boolean;
  show_metadata?: boolean;
}
