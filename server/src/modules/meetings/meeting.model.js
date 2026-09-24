import mongoose from 'mongoose';

export const MEETING_TITLE_MAX = 80;
export const DEFAULT_MAX_PARTICIPANTS = 4;

const meetingSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true },
    title: { type: String, trim: true, maxlength: MEETING_TITLE_MAX, default: '' },
    // Only the hash is stored; select: false keeps it out of queries by default.
    hostKeyHash: { type: String, required: true, select: false },
    status: { type: String, enum: ['active', 'ended'], default: 'active' },
    maxParticipants: { type: Number, default: DEFAULT_MAX_PARTICIPANTS },
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
    maxParticipants: this.maxParticipants,
    createdAt: this.createdAt,
  };
};

export const Meeting = mongoose.model('Meeting', meetingSchema);
