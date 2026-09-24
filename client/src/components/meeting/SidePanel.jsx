import { useEffect, useRef } from 'react';
import { CloseIcon } from '../icons.jsx';

const TABS = [
  { id: 'people', label: 'People' },
  { id: 'chat', label: 'Chat' },
];

/**
 * Right-hand panel (full-screen sheet on phones) with People / Chat tabs.
 * Keyboard: ←/→ switch tabs (WAI-ARIA tabs pattern), Esc closes the panel.
 */
export function SidePanel({ tab, onTabChange, onClose, unread, participantCount, children }) {
  const tabRefs = useRef({});
  const panelRef = useRef(null);

  // Esc closes the panel from anywhere inside it.
  function handleKeyDown(event) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
    }
  }

  function handleTabKeyDown(event) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const index = TABS.findIndex((t) => t.id === tab);
    const next = TABS[(index + (event.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
    onTabChange(next.id);
    tabRefs.current[next.id]?.focus();
  }

  // On open, move focus into the panel (unless a child, e.g. the chat input,
  // already took it) so keyboard users land where they expect.
  useEffect(() => {
    if (!panelRef.current?.contains(document.activeElement)) tabRefs.current[tab]?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <aside ref={panelRef} id="side-panel" className="side-panel" aria-label="Meeting side panel" onKeyDown={handleKeyDown}>
      <div className="side-panel-header">
        <div role="tablist" aria-label="Side panel" className="tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              ref={(el) => (tabRefs.current[t.id] = el)}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`tabpanel-${t.id}`}
              tabIndex={tab === t.id ? 0 : -1}
              className="tab"
              onClick={() => onTabChange(t.id)}
              onKeyDown={handleTabKeyDown}
            >
              {t.label}
              {t.id === 'people' && ` (${participantCount})`}
              {t.id === 'chat' && unread > 0 && <span className="tab-badge">{unread}</span>}
            </button>
          ))}
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close panel" title="Close (Esc)">
          <CloseIcon />
        </button>
      </div>

      <div role="tabpanel" id={`tabpanel-${tab}`} aria-labelledby={`tab-${tab}`} className="side-panel-body">
        {children}
      </div>
    </aside>
  );
}
