import mongoose from 'mongoose';

export const MEETING_TITLE_MAX = 80;
export const DEFAULT_MAX_PARTICIPANTS = 4;
// An empty meeting nobody has touched for this long is treated as expired.
export const MEETING_IDLE_TTL_MS = 24 * 60 * 60 * 1000;
// Ended meetings are kept this long (for "this meeting has ended" pages), then
// deleted by MongoDB's TTL monitor.
export const ENDED_MEETING_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

const meetingSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true },
    title: { type: String, trim: true, maxlength: MEETING_TITLE_MAX, default: '' },
    // Only the hash is stored; select: false keeps it out of queries by default.
    hostKeyHash: { type: String, required: true, select: false },
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

// The public shape returned by the API — never includes hostKeyHash.
meetingSchema.methods.toPublic = function toPublic() {
  return {
    code: this.code,
    title: this.title,
    status: this.status,
    ...(this.endedReason && { endedReason: this.endedReason }),
    maxParticipants: this.maxParticipants,
    createdAt: this.createdAt,
  };
};

export const Meeting = mongoose.model('Meeting', meetingSchema);
