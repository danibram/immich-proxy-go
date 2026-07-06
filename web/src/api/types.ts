export interface SharedLink {
  id: string;
  key: string;
  type: 'ALBUM' | 'INDIVIDUAL';
  userId: string;
  createdAt: string;
  expiresAt: string | null;
  allowUpload: boolean;
  allowDownload: boolean;
  showMetadata: boolean;
  description: string;
  album: Album | null;
  assets: Asset[];
}

export interface Album {
  id: string;
  albumName: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  albumThumbnailAssetId: string;
  shared: boolean;
  hasSharedLink: boolean;
  startDate: string | null;
  endDate: string | null;
  assets: Asset[];
  assetCount: number;
  owner: User | null;
  ownerId: string;
  albumUsers: AlbumUser[];
  isActivityEnabled: boolean;
  order: string;
  lastModifiedAssetTimestamp: string | null;
}

export interface AlbumUser {
  user: User;
  role: 'editor' | 'viewer';
}

export interface Asset {
  id: string;
  deviceAssetId: string;
  deviceId: string;
  ownerId: string;
  type: 'IMAGE' | 'VIDEO' | 'AUDIO' | 'OTHER';
  originalPath: string;
  originalFileName: string;
  originalMimeType?: string;
  thumbhash: string;
  fileCreatedAt: string;
  fileModifiedAt: string;
  localDateTime: string;
  updatedAt: string;
  isFavorite: boolean;
  isArchived: boolean;
  isTrashed: boolean;
  isOffline: boolean;
  duration: string;
  exifInfo?: ExifInfo;
  /** Display aspect ratio (width/height); provided by Immich v3, which no longer exposes EXIF dimensions in listings. */
  ratio?: number;
  livePhotoVideoId?: string;
  people?: Person[];
  checksum: string;
  stack?: Stack;
  duplicateId?: string;
  hasMetadata: boolean;
}

export interface ExifInfo {
  make?: string;
  model?: string;
  exifImageWidth?: number;
  exifImageHeight?: number;
  fileSizeInByte?: number;
  orientation?: string;
  dateTimeOriginal?: string;
  modifyDate?: string;
  timeZone?: string;
  lensModel?: string;
  fNumber?: number;
  focalLength?: number;
  iso?: number;
  exposureTime?: string;
  latitude?: number;
  longitude?: number;
  city?: string;
  state?: string;
  country?: string;
  description?: string;
  projectionType?: string;
  rating?: number;
}

export interface User {
  id: string;
  email: string;
  name: string;
  profileImagePath: string;
  avatarColor: string;
  profileChangedAt: string;
}

export interface Person {
  id: string;
  name: string;
  birthDate?: string;
  thumbnailPath: string;
  isHidden: boolean;
  updatedAt?: string;
}

export interface Stack {
  id: string;
  primaryAssetId: string;
  assetCount: number;
}
