// Socket.IO rooms used per meeting. Only admitted participants are in the
// meeting room itself, so waiting people never receive meeting traffic.
export const meetingRoom = (code) => code; // everyone admitted (media, chat, presence)
export const hostsRoom = (code) => `${code}:hosts`; // host sockets (waiting-room updates)
export const lobbyRoom = (code) => `${code}:lobby`; // people in the waiting room
