// Small inline icon set (stroke icons, 24x24, inherit currentColor).
function Icon({ children, ...props }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export const MicIcon = (p) => (
  <Icon {...p}>
    <rect x="9" y="2" width="6" height="12" rx="3" />
    <path d="M5 10a7 7 0 0 0 14 0M12 17v5" />
  </Icon>
);

export const MicOffIcon = (p) => (
  <Icon {...p}>
    <path d="M15 9.3V5a3 3 0 0 0-5.7-1.3M9 9v2a3 3 0 0 0 5 2.2M19 10a7 7 0 0 1-1.2 3.9M5 10a7 7 0 0 0 11 5.7M12 17v5M3 3l18 18" />
  </Icon>
);

export const CamIcon = (p) => (
  <Icon {...p}>
    <rect x="2" y="6" width="14" height="12" rx="2" />
    <path d="m16 10 6-3v10l-6-3z" />
  </Icon>
);

export const CamOffIcon = (p) => (
  <Icon {...p}>
    <path d="M10.7 6H14a2 2 0 0 1 2 2v3.3l6-3.3v10M16 16v0a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2M3 3l18 18" />
  </Icon>
);

export const LeaveIcon = (p) => (
  <Icon {...p}>
    <path d="M10 17l-5-5 5-5M5 12h11M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
  </Icon>
);
