import { useState, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import nestClient from '../../api/nest-client';

interface UploadResult {
  id: number;
  type: 'xray' | 'lab';
  originalName: string;
  pid: number;
  message: string;
}

interface ImagingUploadProps {
  type: 'xray' | 'lab';
  pid: number;
  eid?: number;
  onSuccess?: (result: UploadResult) => void;
  className?: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const LABELS: Record<'xray' | 'lab', { title: string; icon: string; accept: string }> = {
  xray: {
    title: 'X-Ray / DICOM',
    icon: 'bi-image',
    accept: '.dcm,.jpg,.jpeg,.png,.tiff,.bmp',
  },
  lab: {
    title: 'Lab Document',
    icon: 'bi-flask',
    accept: '.pdf,.jpg,.jpeg,.png,.doc,.docx,.txt,.csv',
  },
};

export default function ImagingUpload({ type, pid, eid, onSuccess, className }: ImagingUploadProps) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [description, setDescription] = useState('');
  const [uploaded, setUploaded] = useState<UploadResult | null>(null);
  const [uploadError, setUploadError] = useState('');

  const labels = LABELS[type];

  const mutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('No file selected');
      const formData = new FormData();
      formData.append('file', file);
      formData.append('type', type);
      formData.append('pid', String(pid));
      if (eid) formData.append('eid', String(eid));
      if (description) formData.append('description', description);

      const r = await nestClient.post('/imaging/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return r.data as UploadResult;
    },
    onSuccess: (data) => {
      setUploaded(data);
      setUploadError('');
      queryClient.invalidateQueries({ queryKey: ['imaging', pid, type] });
      onSuccess?.(data);
    },
    onError: (err: any) => {
      const msg = err.response?.data?.message || err.response?.statusText || err.message || 'Upload failed';
      if (err.response?.status === 401 || err.response?.status === 403) {
        setUploadError('Authentication required. Please log in first.');
      } else {
        setUploadError(msg);
      }
    },
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      setFile(f);
      setUploaded(null);
    }
  };

  const handleUpload = () => {
    if (!file) return;
    mutation.mutate();
  };

  const reset = () => {
    setFile(null);
    setDescription('');
    setUploaded(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className={className}>
      {!uploaded ? (
        <div className="card bg-light border">
          <div className="card-body py-2">
            <div className="d-flex align-items-center gap-2 mb-2">
              <i className={`bi ${labels.icon} text-primary`}></i>
              <span className="small fw-semibold">Upload {labels.title}</span>
            </div>

            <div className="row g-2 align-items-end">
              <div className="col-md-7">
                <input
                  ref={fileInputRef}
                  type="file"
                  className="form-control form-control-sm"
                  onChange={handleFileSelect}
                  accept={labels.accept}
                />
                {file && (
                  <div className="mt-1 small text-muted">
                    <i className="bi bi-paperclip me-1"></i>
                    {file.name} ({formatSize(file.size)})
                  </div>
                )}
              </div>
              <div className="col-md-3">
                <input
                  className="form-control form-control-sm"
                  placeholder="Description (optional)"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <div className="col-md-2">
                <button
                  className="btn btn-primary btn-sm w-100"
                  onClick={handleUpload}
                  disabled={!file || mutation.isPending}
                >
                  {mutation.isPending ? (
                    <span className="spinner-border spinner-border-sm"></span>
                  ) : (
                    <><i className="bi bi-cloud-upload me-1"></i>Upload</>
                  )}
                </button>
              </div>
            </div>

            {mutation.isError && (
              <div className="alert alert-danger small py-1 mt-2 mb-0">
                <i className="bi bi-exclamation-triangle me-1"></i>
                {uploadError || 'Upload failed. Please try again.'}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="alert alert-success small d-flex align-items-center gap-3 mb-0 py-2">
          <i className="bi bi-check-circle fs-5"></i>
          <div className="flex-grow-1">
            <strong>{uploaded.originalName}</strong> uploaded to Backblaze B2
            <span className="text-muted ms-2">({labels.title})</span>
          </div>
          <button className="btn btn-outline-success btn-sm" onClick={reset}>
            Upload Another
          </button>
        </div>
      )}
    </div>
  );
}
