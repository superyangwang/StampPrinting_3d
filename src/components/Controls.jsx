export default function Controls({
  params,
  setParams,
  onUpload,
  onGenerate,
  onDownload,
  hasImage,
  hasGeometry,
  hasStl,
  busy,
  error,
}) {
  const update = (patch) => setParams({ ...params, ...patch });
  const isRound = params.shape === 'round';

  const num = (key, props = {}) => (
    <input
      type="number"
      value={params[key]}
      step={props.step ?? 0.5}
      min={props.min ?? 0}
      max={props.max}
      onChange={(e) => update({ [key]: Number(e.target.value) })}
    />
  );

  // For round, "size" sets both width and depth together (uniform diameter).
  const setSize = (mm) => update({ widthMm: mm, depthMm: mm });

  return (
    <aside className="controls">
      <h2>Stamp Generator</h2>

      <section>
        <label className="upload">
          <span>{hasImage ? 'Replace image' : 'Upload image'}</span>
          <input
            type="file"
            accept="image/png,image/jpeg,image/svg+xml,image/webp"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUpload(f);
            }}
          />
        </label>
        <p className="hint">
          Black = raised by default. Toggle <em>Invert</em> if your image is light-on-dark.
        </p>
      </section>

      <section>
        <h3>Shape</h3>
        <div className="shape-toggle" role="radiogroup">
          <label className={`shape-opt ${isRound ? 'active' : ''}`}>
            <input
              type="radio"
              name="shape"
              checked={isRound}
              onChange={() => update({ shape: 'round' })}
            />
            Round
          </label>
          <label className={`shape-opt ${isRound ? '' : 'active'}`}>
            <input
              type="radio"
              name="shape"
              checked={!isRound}
              onChange={() => update({ shape: 'rect' })}
            />
            Rectangle
          </label>
        </div>
      </section>

      <section>
        <h3>Stamp size (mm)</h3>
        {isRound ? (
          <label>
            Diameter
            <input
              type="number"
              value={params.widthMm}
              step={1}
              min={5}
              onChange={(e) => setSize(Number(e.target.value))}
            />
          </label>
        ) : (
          <div className="row">
            <label>Width {num('widthMm', { step: 1, min: 5 })}</label>
            <label>Depth {num('depthMm', { step: 1, min: 5 })}</label>
          </div>
        )}
      </section>

      <section>
        <h3>Relief & base</h3>
        <div className="row">
          <label>Relief depth (mm) {num('reliefDepthMm', { step: 0.1, min: 0.2 })}</label>
          <label>Base thickness (mm) {num('baseThicknessMm', { step: 0.5, min: 0.5 })}</label>
        </div>
        <label style={{ marginTop: 10 }}>
          Draft angle: {params.draftAngleDeg.toFixed(1)}&deg;
          <input
            type="range"
            min={0}
            max={15}
            step={0.5}
            value={params.draftAngleDeg}
            onChange={(e) => update({ draftAngleDeg: Number(e.target.value) })}
          />
        </label>
        <p className="hint">
          Tapers walls inward toward the top so the stamp releases cleanly
          from clay. 0&deg; = vertical walls; 5&ndash;10&deg; works well for
          most patterns. Very thin lines may pinch if the angle is too steep.
        </p>
        <label className="check" style={{ marginTop: 10 }}>
          <input
            type="checkbox"
            checked={params.invert}
            onChange={(e) => update({ invert: e.target.checked })}
          />
          Invert (light = raised)
        </label>
        <label className="check" style={{ marginTop: 6 }}>
          <input
            type="checkbox"
            checked={params.mirror}
            onChange={(e) => update({ mirror: e.target.checked })}
          />
          Mirror (flip horizontally)
        </label>
        <p className="hint">
          Stamps print a mirror image into clay. Enable this if you want
          the imprint to read the same direction as your source.
        </p>
      </section>

      <section>
        <h3>Lines</h3>
        <label>
          Image scale: {params.imageScalePct}% of stamp
          <input
            type="range"
            min={50}
            max={100}
            step={1}
            value={params.imageScalePct}
            onChange={(e) => update({ imageScalePct: Number(e.target.value) })}
          />
        </label>
        <label style={{ marginTop: 10 }}>
          Line sensitivity: {params.threshold.toFixed(2)}
          <input
            type="range"
            min={0.1}
            max={0.7}
            step={0.01}
            value={params.threshold}
            onChange={(e) => update({ threshold: Number(e.target.value) })}
          />
        </label>
        <label style={{ marginTop: 10 }}>
          Contrast boost: {params.contrast.toFixed(1)}×
          <input
            type="range"
            min={1}
            max={3}
            step={0.1}
            value={params.contrast}
            onChange={(e) => update({ contrast: Number(e.target.value) })}
          />
        </label>
        <label style={{ marginTop: 10 }}>
          Line thickness: +{params.lineThickenPx.toFixed(2)}px
          <input
            type="range"
            min={0}
            max={4}
            step={0.25}
            value={params.lineThickenPx}
            onChange={(e) => update({ lineThickenPx: Number(e.target.value) })}
          />
        </label>
        <label style={{ marginTop: 10 }}>
          Wall smoothing: {params.smoothIterations}
          <input
            type="range"
            min={0}
            max={3}
            step={1}
            value={params.smoothIterations}
            onChange={(e) => update({ smoothIterations: Number(e.target.value) })}
          />
        </label>
        <p className="hint">
          Lower sensitivity / higher contrast = thicker lines. Wall smoothing
          rounds the staircase pixel edges.
        </p>
      </section>

      <section>
        <label className="check">
          <input
            type="checkbox"
            checked={params.rollingEnabled}
            onChange={(e) => update({ rollingEnabled: e.target.checked })}
          />
          Rolling stamp (curved face)
        </label>
        <div className={params.rollingEnabled ? '' : 'disabled'} style={{ marginTop: 10 }}>
          <label>
            Rolling radius (mm)
            <input
              type="number"
              value={params.rollingRadiusMm}
              step={5}
              min={params.widthMm / 2}
              disabled={!params.rollingEnabled}
              onChange={(e) => update({ rollingRadiusMm: Number(e.target.value) })}
            />
          </label>
          <p className="hint">
            Replaces the flat top with a cylindrical curve so you can roll the
            stamp onto clay. Larger radius = gentler curve. Must be at least
            half the stamp width ({(params.widthMm / 2).toFixed(1)} mm). Round
            shape is overridden — the base becomes a rectangular rocker.
          </p>
          <label className="check" style={{ marginTop: 10 }}>
            <input
              type="checkbox"
              checked={params.rollingFlatCompensate}
              disabled={!params.rollingEnabled}
              onChange={(e) => update({ rollingFlatCompensate: e.target.checked })}
            />
            Compensate stretch on flat surface
          </label>
          <p className="hint">
            When rolled on a flat surface, the curved top sweeps a longer
            arc than its chord, so the imprint comes out wider than your
            design. Tick this to pre-shrink the pattern along X so a flat
            roll matches the design width exactly. Leave off if you're
            rolling onto a curved surface.
          </p>
        </div>
      </section>

      <section>
        <label className="check">
          <input
            type="checkbox"
            checked={params.handleEnabled}
            onChange={(e) => update({ handleEnabled: e.target.checked })}
          />
          Handle
        </label>
        <div className={params.handleEnabled ? '' : 'disabled'}>
          <label style={{ marginTop: 10 }}>
            Cone height (mm)
            <input
              type="number"
              value={params.handleHeightMm}
              step={1}
              min={1}
              disabled={!params.handleEnabled}
              onChange={(e) => update({ handleHeightMm: Number(e.target.value) })}
            />
          </label>
          <div className="row" style={{ marginTop: 10 }}>
            <label>
              Grip height (mm)
              <input
                type="number"
                value={params.handleGripHeightMm}
                step={1}
                min={0}
                disabled={!params.handleEnabled}
                onChange={(e) => update({ handleGripHeightMm: Number(e.target.value) })}
              />
            </label>
            <label>
              Grip radius (mm)
              <input
                type="number"
                value={params.handleGripRadiusMm}
                step={0.5}
                min={1}
                disabled={!params.handleEnabled || params.handleGripHeightMm <= 0}
                onChange={(e) => update({ handleGripRadiusMm: Number(e.target.value) })}
              />
            </label>
          </div>
          <p className="hint">
            The cone tapers from the full stamp footprint down to the grip&apos;s
            footprint over the cone height — slope is auto-fit so the cone
            and grip join seamlessly with no visible step. Grip mirrors the
            stamp shape (round &rarr; cylinder, rectangle &rarr; rectangular prism
            with the same aspect ratio). For rectangle stamps, grip radius =
            half the longer side. Set grip height to 0 to keep the cone&apos;s
            flat truncated tip without an attached prism.
          </p>
        </div>
      </section>

      {error && <p className="error">{error}</p>}

      <div className="actions">
        <button
          type="button"
          className="secondary"
          onClick={onGenerate}
          disabled={!hasGeometry || busy}
        >
          {busy ? 'Working…' : hasStl ? 'Regenerate STL' : 'Generate STL'}
        </button>
        <button
          type="button"
          className="primary"
          onClick={onDownload}
          disabled={!hasStl || busy}
        >
          Download STL
        </button>
      </div>
    </aside>
  );
}
