import { CamIcon, CamOffIcon, MicIcon, MicOffIcon } from './icons.jsx';

/** Mic + camera toggles, shared by the lobby and the meeting room. */
export function MediaControls({ media }) {
  const { micOn, camOn, toggleMic, toggleCamera } = media;

  return (
    <>
      <button
        type="button"
        className={`control ${micOn ? '' : 'control-off'}`}
        onClick={toggleMic}
        aria-pressed={!micOn}
        aria-label={micOn ? 'Turn off microphone' : 'Turn on microphone'}
        title={micOn ? 'Mute' : 'Unmute'}
      >
        {micOn ? <MicIcon /> : <MicOffIcon />}
      </button>
      <button
        type="button"
        className={`control ${camOn ? '' : 'control-off'}`}
        onClick={toggleCamera}
        aria-pressed={!camOn}
        aria-label={camOn ? 'Turn off camera' : 'Turn on camera'}
        title={camOn ? 'Stop video' : 'Start video'}
      >
        {camOn ? <CamIcon /> : <CamOffIcon />}
      </button>
    </>
  );
}
