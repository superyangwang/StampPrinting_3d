import { useState } from 'react';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default function EmailGateModal({ defaultEmail, onCancel, onConfirm }) {
  const [email, setEmail] = useState(defaultEmail || '');
  const [touched, setTouched] = useState(false);
  const valid = EMAIL_RE.test(email.trim());

  const submit = (e) => {
    e.preventDefault();
    setTouched(true);
    if (valid) onConfirm(email.trim());
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <form
        className="modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <h3>Almost there!</h3>
        <p>Enter your email to download your stamp STL.</p>
        <label>
          Email
          <input
            type="email"
            autoFocus
            value={email}
            placeholder="you@example.com"
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() => setTouched(true)}
          />
        </label>
        {touched && !valid && (
          <p className="error">Please enter a valid email address.</p>
        )}
        <p className="hint">
          We only use this to see how the tool is being used. No spam.
        </p>
        <div className="actions">
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!valid}>
            Download
          </button>
        </div>
      </form>
    </div>
  );
}
