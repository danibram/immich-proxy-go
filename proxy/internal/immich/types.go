package immich

import "time"

// SharedLink represents an Immich shared link
type SharedLink struct {
	ID            string     `json:"id"`
	Key           string     `json:"key"`
	Type          string     `json:"type"` // ALBUM or INDIVIDUAL
	UserID        string     `json:"userId"`
	CreatedAt     time.Time  `json:"createdAt"`
	ExpiresAt     *time.Time `json:"expiresAt"`
	AllowUpload   bool       `json:"allowUpload"`
	AllowDownload bool       `json:"allowDownload"`
	ShowMetadata  bool       `json:"showMetadata"`
	Description   string     `json:"description"`
	Password      string     `json:"password,omitempty"`
	Token         string     `json:"token,omitempty"`
	Album         *Album     `json:"album,omitempty"`
	Assets        []Asset    `json:"assets"`
}

// Album represents an Immich album
type Album struct {
	ID                         string      `json:"id"`
	AlbumName                  string      `json:"albumName"`
	Description                string      `json:"description"`
	CreatedAt                  time.Time   `json:"createdAt"`
	UpdatedAt                  time.Time   `json:"updatedAt"`
	AlbumThumbnailAssetID      string      `json:"albumThumbnailAssetId"`
	Shared                     bool        `json:"shared"`
	HasSharedLink              bool        `json:"hasSharedLink"`
	StartDate                  *time.Time  `json:"startDate"`
	EndDate                    *time.Time  `json:"endDate"`
	Assets                     []Asset     `json:"assets"`
	AssetCount                 int         `json:"assetCount"`
	Owner                      *User       `json:"owner"`
	OwnerID                    string      `json:"ownerId"`
	AlbumUsers                 []AlbumUser `json:"albumUsers"`
	IsActivityEnabled          bool        `json:"isActivityEnabled"`
	Order                      string      `json:"order"`
	LastModifiedAssetTimestamp *time.Time  `json:"lastModifiedAssetTimestamp"`
}

// AlbumUser represents a user with access to an album
type AlbumUser struct {
	User User   `json:"user"`
	Role string `json:"role"` // editor or viewer
}

// Asset represents an Immich asset (photo/video)
type Asset struct {
	ID               string     `json:"id"`
	DeviceAssetID    string     `json:"deviceAssetId"`
	DeviceID         string     `json:"deviceId"`
	OwnerID          string     `json:"ownerId"`
	Type             string     `json:"type"` // IMAGE, VIDEO, AUDIO, OTHER
	OriginalPath     string     `json:"originalPath"`
	OriginalFileName string     `json:"originalFileName"`
	OriginalMimeType string     `json:"originalMimeType,omitempty"`
	Thumbhash        string     `json:"thumbhash"`
	FileCreatedAt    time.Time  `json:"fileCreatedAt"`
	FileModifiedAt   time.Time  `json:"fileModifiedAt"`
	LocalDateTime    time.Time  `json:"localDateTime"`
	UpdatedAt        time.Time  `json:"updatedAt"`
	IsFavorite       bool       `json:"isFavorite"`
	IsArchived       bool       `json:"isArchived"`
	IsTrashed        bool       `json:"isTrashed"`
	IsOffline        bool       `json:"isOffline"`
	Duration         Duration   `json:"duration"`
	ExifInfo         *ExifInfo  `json:"exifInfo,omitempty"`
	// Ratio is the display aspect ratio (width/height) reported by the
	// Immich v3 timeline API, which no longer exposes EXIF dimensions.
	Ratio            float64    `json:"ratio,omitempty"`
	LivePhotoVideoID *string    `json:"livePhotoVideoId,omitempty"`
	People           []Person   `json:"people,omitempty"`
	Checksum         string     `json:"checksum"`
	Stack            *Stack     `json:"stack,omitempty"`
	DuplicateID      *string    `json:"duplicateId,omitempty"`
	HasMetadata      bool       `json:"hasMetadata"`
}

// ExifInfo represents EXIF metadata for an asset
type ExifInfo struct {
	Make             string     `json:"make,omitempty"`
	Model            string     `json:"model,omitempty"`
	ExifImageWidth   float64    `json:"exifImageWidth,omitempty"`
	ExifImageHeight  float64    `json:"exifImageHeight,omitempty"`
	FileSizeInByte   int64      `json:"fileSizeInByte,omitempty"`
	Orientation      string     `json:"orientation,omitempty"`
	DateTimeOriginal *time.Time `json:"dateTimeOriginal,omitempty"`
	ModifyDate       *time.Time `json:"modifyDate,omitempty"`
	TimeZone         string     `json:"timeZone,omitempty"`
	LensModel        string     `json:"lensModel,omitempty"`
	FNumber          float64    `json:"fNumber,omitempty"`
	FocalLength      float64    `json:"focalLength,omitempty"`
	ISO              float64    `json:"iso,omitempty"`
	ExposureTime     string     `json:"exposureTime,omitempty"`
	Latitude         float64    `json:"latitude,omitempty"`
	Longitude        float64    `json:"longitude,omitempty"`
	City             string     `json:"city,omitempty"`
	State            string     `json:"state,omitempty"`
	Country          string     `json:"country,omitempty"`
	Description      string     `json:"description,omitempty"`
	ProjectionType   string     `json:"projectionType,omitempty"`
	Rating           float64    `json:"rating,omitempty"`
}

// User represents an Immich user
type User struct {
	ID               string    `json:"id"`
	Email            string    `json:"email"`
	Name             string    `json:"name"`
	ProfileImagePath string    `json:"profileImagePath"`
	AvatarColor      string    `json:"avatarColor"`
	ProfileChangedAt time.Time `json:"profileChangedAt"`
}

// Person represents a recognized person in Immich
type Person struct {
	ID            string    `json:"id"`
	Name          string    `json:"name"`
	BirthDate     string    `json:"birthDate,omitempty"`
	ThumbnailPath string    `json:"thumbnailPath"`
	IsHidden      bool      `json:"isHidden"`
	UpdatedAt     time.Time `json:"updatedAt,omitempty"`
}

// Stack represents a stack of assets
type Stack struct {
	ID             string `json:"id"`
	PrimaryAssetID string `json:"primaryAssetId"`
	AssetCount     int    `json:"assetCount"`
}

// UploadResponse represents the response from uploading an asset
type UploadResponse struct {
	ID        string `json:"id"`
	Duplicate bool   `json:"duplicate"`
}

// ErrorResponse represents an error from the Immich API
type ErrorResponse struct {
	Message    string `json:"message"`
	Error      string `json:"error"`
	StatusCode int    `json:"statusCode"`
}
