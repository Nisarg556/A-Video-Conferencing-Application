import mongoose from 'mongoose';

export const MEETING_TITLE_MAX = 80;
export const DEFAULT_MAX_PARTICIPANTS = 4;
// An empty meeting nobody has touched for this long is treated as expired.
export const MEETING_IDLE_TTL_MS = 24 * 60 * 60 * 1000;
// Ended meetings stay in the host's history this long, then MongoDB's TTL
// monitor deletes them. (Chat is deleted as soon as a meeting ends.)
export const ENDED_MEETING_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

const settingsSchema = new mongoose.Schema(
  {
    // Guests (not signed in) may join by link.
    allowGuests: { type: Boolean, default: true },
    // Everyone except the host waits until the host admits them.
    waitingRoom: { type: Boolean, default: false },
    // Nobody new can join (the host can still admit people already waiting).
    locked: { type: Boolean, default: false },
  },
  { _id: false },
);

const meetingSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true },
    title: { type: String, trim: true, maxlength: MEETING_TITLE_MAX, default: '' },
    // Ownership: the signed-in user who created the meeting is its host.
    hostUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    hostName: { type: String, required: true }, // denormalized for the lobby ("Hosted by …")
    settings: { type: settingsSchema, default: () => ({}) },
    // Signed-in users the host removed; they can't rejoin this meeting.
    bannedUserIds: { type: [mongoose.Schema.Types.ObjectId], default: [], select: false },
    status: { type: String, enum: ['active', 'ended'], default: 'active' },
    endedReason: { type: String, enum: ['host_ended', 'expired'] },
    maxParticipants: { type: Number, default: DEFAULT_MAX_PARTICIPANTS },
    // Bumped whenever someone joins or leaves; drives idle expiry.
    lastActiveAt: { type: Date, default: Date.now },
    endedAt: { type: Date },
    // Set when a meeting ends; the TTL index lets Mongo delete it automatically.
    expiresAt: { type: Date, index: { expireAfterSeconds: 0 } },
  },
  { timestamps: true },
);

meetingSchema.methods.isHostedBy = function isHostedBy(user) {
  return Boolean(user) && this.hostUserId.equals(user._id);
};

// The public shape returned by the API.
meetingSchema.methods.toPublic = function toPublic() {
  return {
    code: this.code,
    title: this.title,
    hostName: this.hostName,
    status: this.status,
    ...(this.endedReason && { endedReason: this.endedReason }),
    settings: {
      allowGuests: this.settings.allowGuests,
      waitingRoom: this.settings.waitingRoom,
      locked: this.settings.locked,
    },
    maxParticipants: this.maxParticipants,
    createdAt: this.createdAt,
    ...(this.endedAt && { endedAt: this.endedAt }),
  };
};

export const Meeting = mongoose.model('Meeting', meetingSchema);
