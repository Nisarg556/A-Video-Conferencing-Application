import { useState } from 'react';

export function CopyLink({ url, label = 'Invite link' }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked; the link is still visible to select manually.
    }
  }

  return (
    <div className="field">
      <label htmlFor="invite">{label}</label>
      <div className="copy-row">
        <input id="invite" className="input" value={url} readOnly onFocus={(e) => e.target.select()} />
        <button type="button" className="btn btn-secondary" onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}
