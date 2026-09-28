import { useState, useRef, useEffect, useCallback } from 'react';
import ImagingUpload from '../../components/common/ImagingUpload';

declare global {
  interface Window {
    cornerstone: any;
    cornerstoneWADOImageLoader: any;
    dicomParser: any;
  }
}

export default function DicomViewerPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [fileName, setFileName] = useState('');
  const [viewerPid, setViewerPid] = useState('1');
  const [metadata, setMetadata] = useState<Record<string, string>>({});
  const [windowWidth, setWindowWidth] = useState(400);
  const [windowCenter, setWindowCenter] = useState(40);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState('');

  // Load Cornerstone from CDN
  useEffect(() => {
    if (window.cornerstone) { setLoaded(true); return; }

    const loadScript = (src: string): Promise<void> => new Promise((resolve, reject) => {
      const s = document.createElement('script'); s.src = src; s.onload = () => resolve(); s.onerror = reject; document.head.appendChild(s);
    });

    Promise.all([
      loadScript('https://unpkg.com/cornerstone-core@2.6.1/dist/cornerstone.min.js'),
      loadScript('https://unpkg.com/dicom-parser@1.8.21/dist/dicomParser.min.js'),
      loadScript('https://unpkg.com/cornerstone-wado-image-loader@4.3.0/dist/cornerstoneWADOImageLoader.bundle.min.js'),
    ]).then(() => {
      window.cornerstoneWADOImageLoader.external.cornerstone = window.cornerstone;
      window.cornerstoneWADOImageLoader.external.dicomParser = window.dicomParser;
      const config = { webWorkerPath: 'https://unpkg.com/cornerstone-wado-image-loader@4.3.0/dist/' };
      window.cornerstoneWADOImageLoader.webWorkerManager.initialize(config);
      setLoaded(true);
    }).catch(() => setError('Failed to load DICOM viewer libraries. Check internet connection.'));
  }, []);

  // Initialize cornerstone when canvas mounts
  useEffect(() => {
    if (!loaded || !canvasRef.current) return;
    try {
      window.cornerstone.enable(canvasRef.current);
    } catch { /* already enabled */ }
  }, [loaded]);

  const loadDicomFile = useCallback(async (file: File) => {
    if (!window.cornerstone || !canvasRef.current) return;
    setFileName(file.name);
    setError('');

    try {
      const arrayBuffer = await file.arrayBuffer();
      const byteArray = new Uint8Array(arrayBuffer);

      // Parse DICOM metadata
      try {
        const dataSet = window.dicomParser.parseDicom(byteArray);
        const meta: Record<string, string> = {};
        const tags: [string, string][] = [
          ['x00100010', 'Patient Name'], ['x00100020', 'Patient ID'],
          ['x00100030', 'Birth Date'], ['x00100040', 'Sex'],
          ['x00080020', 'Study Date'], ['x00080030', 'Study Time'],
          ['x00080060', 'Modality'], ['x00081030', 'Study Description'],
          ['x00280010', 'Rows'], ['x00280011', 'Columns'],
          ['x00280100', 'Bits Allocated'], ['x00280004', 'Photometric Interpretation'],
        ];
        for (const [tag, label] of tags) {
          const el = dataSet.elements[tag];
          if (el) meta[label] = dataSet.string(tag);
        }
        setMetadata(meta);
      } catch { /* metadata parse failure is OK */ }

      // Display image
      const imageId = window.cornerstoneWADOImageLoader.wadouri.fileManager.add(file);
      await window.cornerstone.loadImage(imageId);
      const viewport = window.cornerstone.getDefaultViewportForImage(canvasRef.current, imageId);
      window.cornerstone.displayImage(canvasRef.current, imageId);
      window.cornerstone.setViewport(canvasRef.current, viewport);
      setWindowWidth(viewport.voi.windowWidth);
      setWindowCenter(viewport.voi.windowCenter);
    } catch (e: any) {
      setError('Failed to load DICOM file: ' + (e.message || 'Unknown error'));
    }
  }, []);

  const applyWindowLevel = (ww: number, wc: number) => {
    if (!canvasRef.current) return;
    setWindowWidth(ww); setWindowCenter(wc);
    const viewport = window.cornerstone.getViewport(canvasRef.current);
    viewport.voi.windowWidth = ww;
    viewport.voi.windowCenter = wc;
    window.cornerstone.setViewport(canvasRef.current, viewport);
  };

  const applyZoom = (z: number) => {
    if (!canvasRef.current) return;
    setZoom(z);
    const viewport = window.cornerstone.getViewport(canvasRef.current);
    viewport.scale = z;
    window.cornerstone.setViewport(canvasRef.current, viewport);
  };

  const presets = [
    { label: 'Lung', ww: 1500, wc: -600 },
    { label: 'Bone', ww: 2000, wc: 300 },
    { label: 'Abdomen', ww: 400, wc: 40 },
    { label: 'Brain', ww: 80, wc: 40 },
  ];

  return (
    <div className="glass-page position-relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #dbeafe 0%, #f5faff 45%, #d1fae5 100%)', borderRadius: '20px', minHeight: '100vh', padding: '16px' }}>
      <div className="position-absolute rounded-circle" style={{ width: '340px', height: '340px', top: '-80px', right: '-60px', background: 'radial-gradient(circle, rgba(13,110,253,0.30), transparent 70%)', filter: 'blur(20px)', zIndex: 0 }}></div>
      <div className="position-absolute rounded-circle" style={{ width: '400px', height: '400px', bottom: '8%', left: '-120px', background: 'radial-gradient(circle, rgba(0,201,167,0.30), transparent 70%)', filter: 'blur(20px)', zIndex: 0 }}></div>
      <style>{`
        .glass-page .card {
          position: relative;
          z-index: 1;
          background: rgba(255,255,255,0.60) !important;
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border: 1px solid rgba(255,255,255,0.9) !important;
          box-shadow: 0 22px 45px rgba(10,37,64,0.20), 0 6px 14px rgba(10,37,64,0.10) !important;
          transition: transform .25s ease, box-shadow .25s ease, background .25s ease;
        }
        .glass-page .card:hover {
          transform: translateY(-5px);
          background: rgba(255,255,255,0.70) !important;
          box-shadow: 0 30px 60px rgba(10,37,64,0.28), 0 10px 20px rgba(10,37,64,0.14) !important;
        }
        .glass-page .card .card-header,
        .glass-page .card-header {
          background: rgba(255,255,255,0.35) !important;
          border-bottom: 1px solid rgba(255,255,255,0.6) !important;
        }
      `}</style>
      <div className="rounded-4 p-4 mb-4 text-white position-relative" style={{background:'linear-gradient(135deg, #6f42c1 0%, #0d6efd 40%, #0dcaf0 100%)', zIndex: 1}}>
        <div className="d-flex justify-content-between align-items-start">
          <div>
            <h2 className="mb-1 fw-bold"><i className="bi bi-image me-2"></i>DICOM / X-Ray Viewer</h2>
            <p className="mb-0 text-white text-opacity-75 small">
              Cornerstone.js · DICOM medical imaging · Windowing & zoom
            </p>
          </div>
          <span className="badge bg-light text-dark">DICOM</span>
        </div>
      </div>

      {!loaded && !error && (
        <div className="text-center p-5"><div className="spinner-border text-primary"/><p className="mt-2">Loading DICOM viewer...</p></div>
      )}

      {error && <div className="alert alert-danger">{error}</div>}

      <div className="row g-3">
        <div className="col-md-9">
          <div className="card shadow-sm">
            <div className="card-body p-0 bg-dark d-flex align-items-center justify-content-center" style={{ minHeight: '500px', position: 'relative' }}>
              <canvas ref={canvasRef} className="w-100 h-100" style={{ display: 'block' }} />
              {!fileName && loaded && (
                <div className="text-center text-white position-absolute">
                  <i className="bi bi-cloud-upload" style={{ fontSize: '3rem' }}></i>
                  <p className="mt-2">Drop a DICOM (.dcm) file here or click to open</p>
                  <button className="btn btn-outline-light" onClick={() => fileInputRef.current?.click()}>
                    <i className="bi bi-folder2-open me-1"></i>Open DICOM File
                  </button>
                  <input ref={fileInputRef} type="file" accept=".dcm,.dicom" className="d-none"
                    onChange={e => { const f = e.target.files?.[0]; if (f) loadDicomFile(f); }} />
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="col-md-3">
          {/* Window/Level */}
          <div className="card shadow-sm mb-3">
            <div className="card-header py-2"><h6 className="mb-0">Window / Level</h6></div>
            <div className="card-body">
              <div className="mb-2"><label className="form-label small">Width</label>
                <input type="range" className="form-range" min={1} max={4000} value={windowWidth} onChange={e => applyWindowLevel(+e.target.value, windowCenter)} /></div>
              <div className="mb-2"><label className="form-label small">Center</label>
                <input type="range" className="form-range" min={-1024} max={3072} value={windowCenter} onChange={e => applyWindowLevel(windowWidth, +e.target.value)} /></div>
              <small>WW: {windowWidth} WC: {windowCenter}</small>
              <div className="d-flex flex-wrap gap-1 mt-2">
                {presets.map(p => (
                  <button key={p.label} className="btn btn-outline-secondary btn-sm" onClick={() => applyWindowLevel(p.ww, p.wc)}>{p.label}</button>
                ))}
              </div>
            </div>
          </div>

          {/* Zoom */}
          <div className="card shadow-sm mb-3">
            <div className="card-header py-2"><h6 className="mb-0">Zoom</h6></div>
            <div className="card-body">
              <div className="d-flex gap-2">
                <button className="btn btn-outline-secondary btn-sm" onClick={() => applyZoom(Math.max(0.1, zoom - 0.2))}><i className="bi bi-zoom-out"></i></button>
                <span className="align-self-center small">{Math.round(zoom * 100)}%</span>
                <button className="btn btn-outline-secondary btn-sm" onClick={() => applyZoom(zoom + 0.2)}><i className="bi bi-zoom-in"></i></button>
                <button className="btn btn-outline-secondary btn-sm" onClick={() => applyZoom(1)}>Reset</button>
              </div>
            </div>
          </div>

          {/* Metadata */}
          {Object.keys(metadata).length > 0 && (
            <div className="card shadow-sm">
              <div className="card-header py-2"><h6 className="mb-0">DICOM Tags</h6></div>
              <div className="card-body p-0">
                <table className="table table-sm small mb-0">
                  <tbody>
                    {Object.entries(metadata).map(([k, v]) => (
                      <tr key={k}><td className="text-muted">{k}</td><td>{v}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Backblaze B2 X-Ray Upload */}
      <div className="mt-4">
        <div className="row g-2 mb-3">
          <div className="col-md-2">
            <input
              className="form-control form-control-sm"
              placeholder="Patient ID"
              value={viewerPid}
              onChange={(e) => setViewerPid(e.target.value)}
            />
          </div>
        </div>
        <div className="card shadow-sm">
          <div className="card-header bg-white">
            <h6 className="mb-0">
              <i className="bi bi-cloud-upload me-2 text-primary"></i>
              Upload X-Ray / DICOM to Backblaze B2
            </h6>
          </div>
          <div className="card-body">
            <ImagingUpload type="xray" pid={parseInt(viewerPid, 10) || 1} />
          </div>
        </div>
      </div>
    </div>
  );
}
