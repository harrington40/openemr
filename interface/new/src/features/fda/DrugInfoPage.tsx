import DrugInformationPanel from './DrugInformationPanel';

export default function DrugInfoPage() {
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

      <div className="rounded-4 p-4 mb-4 text-white position-relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #dc3545 0%, #0d6efd 60%, #00c9a7 100%)', zIndex: 1 }}>
        <div className="position-absolute end-0 top-0 opacity-10" style={{ fontSize: '6rem', transform: 'rotate(10deg) translate(20px,-10px)' }}><i className="bi bi-capsule"></i></div>
        <div className="position-relative">
          <h3 className="mb-1 fw-bold"><i className="bi bi-capsule me-2"></i>Drug Information</h3>
          <p className="mb-0 text-white text-opacity-75 small">
            Powered by <strong>openFDA</strong> + <strong>RxNorm (NIH)</strong> — Search FDA drug labels, adverse events,
            and cross-reference with patient records for interactions and allergies.
          </p>
        </div>
      </div>
      <div style={{ maxWidth: '900px', position: 'relative', zIndex: 1 }}>
        <DrugInformationPanel />
      </div>
    </div>
  );
}
