import { useState, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import nestClient from '../../api/nest-client';

interface AvatarUploadProps {
  /** Whose photo to set. Your own by default; another user needs the privilege. */
  userId?: number;
  currentAvatarUrl?: string;
  /** Fired after a successful upload so the parent can refetch its own query. */
  onAvatarChanged?: () => void;
  size?: number;
}

export default function AvatarUpload({
  userId,
  currentAvatarUrl,
  onAvatarChanged,
  size = 96,
}: AvatarUploadProps) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState('');

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      // Omitted means "my own avatar"; the API only accepts another user's id
      // from roles allowed to manage other people's profiles.
      if (userId) formData.append('userId', String(userId));

      const r = await nestClient.post('/avatars/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return r.data;
    },
    onSuccess: () => {
      // Invalidate the whole ['avatar'] prefix: it covers the sidebar and top
      // bar (['avatar', 'me']) plus the 'me' record itself.
      queryClient.invalidateQueries({ queryKey: ['avatar'] });
      // The caller's page holds its own query (e.g. ['provider-avatar', id]),
      // which this component cannot know about — so let it refresh itself.
      onAvatarChanged?.();
      setPreview(null);
      setError('');
    },
    onError: (err: any) => {
      // Surface the API's reason (e.g. "You can only change your own photo").
      setError(
        err?.response?.data?.message ||
          'Upload failed. Please try a smaller image (max 5MB).',
      );
      setPreview(null);
    },
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate
    if (file.size > 5 * 1024 * 1024) {
      setError('File too large. Maximum size is 5MB.');
      return;
    }
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file.');
      return;
    }

    setError('');

    // Show preview
    const reader = new FileReader();
    reader.onload = (ev) => {
      setPreview(ev.target?.result as string);
    };
    reader.readAsDataURL(file);

    // Upload
    uploadMutation.mutate(file);
  };

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  const displayUrl = preview || currentAvatarUrl;

  return (
    <div className="d-flex flex-column align-items-center gap-2">
      {/* Avatar circle */}
      <div
        onClick={triggerFileInput}
        className="rounded-circle bg-light border d-flex align-items-center justify-content-center position-relative"
        style={{
          width: size,
          height: size,
          cursor: 'pointer',
          overflow: 'hidden',
          transition: 'box-shadow 0.2s',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.boxShadow = '0 0 0 3px rgba(13,110,253,0.3)')}
        onMouseLeave={(e) => (e.currentTarget.style.boxShadow = 'none')}
        title="Click to change avatar"
      >
        {displayUrl ? (
          <img
            src={displayUrl}
            alt="Avatar"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <i className="bi bi-person-fill text-secondary" style={{ fontSize: size * 0.5 }}></i>
        )}

        {/* Upload overlay */}
        <div
          className="position-absolute bottom-0 start-0 end-0 bg-dark bg-opacity-50 d-flex align-items-center justify-content-center"
          style={{ height: '30%' }}
        >
          <i className="bi bi-camera-fill text-white small"></i>
        </div>

        {uploadMutation.isPending && (
          <div className="position-absolute top-0 start-0 w-100 h-100 bg-white bg-opacity-50 d-flex align-items-center justify-content-center">
            <span className="spinner-border spinner-border-sm text-primary"></span>
          </div>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        className="d-none"
        accept="image/png,image/jpeg,image/gif,image/webp"
        onChange={handleFileSelect}
      />

      <small className="text-muted text-center" style={{ fontSize: '0.7rem' }}>
        Click to change<br />avatar (max 5MB)
      </small>

      {error && (
        <small className="text-danger" style={{ fontSize: '0.7rem' }}>
          {error}
        </small>
      )}
    </div>
  );
}
