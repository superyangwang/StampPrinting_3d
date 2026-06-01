import { useEffect, useMemo, useRef, useState } from 'react';
import Controls from './components/Controls.jsx';
import StampViewer from './components/StampViewer.jsx';
import { buildMasks } from './stamp/heightmap.js';
import { buildStampGeometry } from './stamp/mesh.js';
import { geometryToBinarySTL } from './stamp/stl.js';
import './App.css';

const DEFAULT_STAMP_SIZE_MM = 40;
// Handle defaults are derived from the default stamp size:
//   radius = 25% of diameter, height = same as radius, transition = 45°.
const DEFAULT_HANDLE_RADIUS_MM = DEFAULT_STAMP_SIZE_MM * 0.25;

const DEFAULTS = {
  shape: 'round',          // 'round' | 'rect'
  widthMm: DEFAULT_STAMP_SIZE_MM,
  depthMm: DEFAULT_STAMP_SIZE_MM,
  reliefDepthMm: 2,
  baseThicknessMm: 3,
  draftAngleDeg: 5,        // 0..15; tapers walls inward toward the top so the
                           // stamp releases cleanly from clay

  rollingEnabled: false,
  rollingRadiusMm: 50,     // cylinder radius for the curved top; 0 = flat
  rollingFlatCompensate: false, // shrink chord so flat-rolled imprint = design width

  invert: false,
  threshold: 0.3,          // 0..1; lower = more pixels qualify as "black"
  contrast: 1.8,           // 1 = none; >1 pushes grays toward 0/1
  lineThickenPx: 1.5,      // 0..4 mask-pixel dilation radius; fattens raised lines
  smoothIterations: 1,     // 0..3 Chaikin passes on traced contours
  imageScalePct: 90,       // 50..100; shrinks the pattern inside the stamp footprint
  handleEnabled: true,
  handleRadiusMm: DEFAULT_HANDLE_RADIUS_MM,
  handleHeightMm: DEFAULT_HANDLE_RADIUS_MM,
  handleTransitionAngleDeg: 45,
  handleGripHeightMm: 10,
};

async function fileToImageData(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const maxIn = 1024;
    const scale = Math.min(1, maxIn / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(2, Math.round(img.naturalWidth * scale));
    const h = Math.max(2, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function App() {
  const [params, setParams] = useState(DEFAULTS);
  const [imageData, setImageData] = useState(null);
  const [fileName, setFileName] = useState(null);
  const [busy, setBusy] = useState(false);
  const [stlBuffer, setStlBuffer] = useState(null);
  const [error, setError] = useState(null);

  // When the user switches to Rectangle with an image already loaded, refit
  // the footprint to the image's aspect ratio. Same logic as upload-time.
  const prevShapeRef = useRef(params.shape);
  useEffect(() => {
    if (
      params.shape === 'rect' &&
      prevShapeRef.current !== 'rect' &&
      imageData
    ) {
      const aspect = imageData.width / imageData.height;
      const maxDim = Math.max(params.widthMm, params.depthMm);
      const w = aspect >= 1 ? maxDim : Math.max(5, +(maxDim * aspect).toFixed(1));
      const d = aspect >= 1 ? Math.max(5, +(maxDim / aspect).toFixed(1)) : maxDim;
      setParams((p) => ({ ...p, widthMm: w, depthMm: d }));
    }
    prevShapeRef.current = params.shape;
  }, [params.shape, imageData]);

  // Debounce param changes so dragging a slider doesn't rebuild every pixel.
  const [debouncedParams, setDebouncedParams] = useState(params);
  const debounceRef = useRef(0);
  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedParams(params), 120);
    return () => clearTimeout(debounceRef.current);
  }, [params]);

  // Any change to inputs invalidates the cached STL — user must regenerate.
  useEffect(() => {
    setStlBuffer(null);
  }, [imageData, debouncedParams]);

  const geometry = useMemo(() => {
    if (!imageData) return null;
    try {
      const masks = buildMasks(imageData, debouncedParams);
      const g = buildStampGeometry(masks, debouncedParams);
      setError(null);
      return g;
    } catch (err) {
      console.error('Stamp build failed', err);
      setError(err.message || String(err));
      return null;
    }
  }, [imageData, debouncedParams]);

  // Dispose old geometries — three.js holds GPU buffers.
  const lastGeom = useRef(null);
  useEffect(() => {
    if (lastGeom.current && lastGeom.current !== geometry) {
      lastGeom.current.dispose();
    }
    lastGeom.current = geometry;
  }, [geometry]);

  const handleUpload = async (file) => {
    setBusy(true);
    try {
      const data = await fileToImageData(file);
      setImageData(data);
      setFileName(file.name.replace(/\.[^.]+$/, ''));
      // Auto-fit the rectangular stamp to the image's aspect ratio so the
      // pattern isn't squashed into a square footprint. The longer side
      // keeps whatever max(W, D) the user already had; the shorter side
      // is derived from the image aspect (min 5 mm).
      if (params.shape === 'rect') {
        const aspect = data.width / data.height;
        const maxDim = Math.max(params.widthMm, params.depthMm);
        const w = aspect >= 1 ? maxDim : Math.max(5, +(maxDim * aspect).toFixed(1));
        const d = aspect >= 1 ? Math.max(5, +(maxDim / aspect).toFixed(1)) : maxDim;
        setParams({ ...params, widthMm: w, depthMm: d });
      }
    } catch (err) {
      console.error(err);
      alert('Could not decode that image.');
    } finally {
      setBusy(false);
    }
  };

  const handleGenerate = () => {
    if (!geometry) return;
    setBusy(true);
    try {
      const buf = geometryToBinarySTL(geometry);
      setStlBuffer(buf);
    } catch (err) {
      console.error(err);
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDownload = () => {
    if (!stlBuffer) return;
    const blob = new Blob([stlBuffer], { type: 'model/stl' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (fileName || 'stamp') + '.stl';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="app">
      <Controls
        params={params}
        setParams={setParams}
        onUpload={handleUpload}
        onGenerate={handleGenerate}
        onDownload={handleDownload}
        hasImage={!!imageData}
        hasGeometry={!!geometry}
        hasStl={!!stlBuffer}
        busy={busy}
        error={error}
      />
      <StampViewer
        geometry={geometry}
        placeholder={
          imageData
            ? error
              ? `Build failed: ${error}`
              : 'Building preview…'
            : 'Upload an image to see your stamp here.'
        }
      />
    </div>
  );
}
