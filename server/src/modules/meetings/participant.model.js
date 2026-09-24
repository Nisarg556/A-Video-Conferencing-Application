import mongoose from 'mongoose';

export const DISPLAY_NAME_MAX = 40;

/**
 * One document per join request. Durable, authoritative state that the
 * socket layer re-reads on every room:join, so a token issued earlier can't
 * bypass a later decision (denied, removed, locked).
 *
 * status:
 *   waiting  — in the waiting room, can't see or send anything
 *   admitted — may be in the room (auto-admitted, or admitted by the host)
 *   denied   — host refused entry; this token can never enter
 *   removed  — host removed them; this token can never re-enter
 */
const participantSchema = new mongoose.Schema(
  {
    meetingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Meeting', required: true, index: true },
    // Set when the person was signed in; drives meeting history and bans.
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    displayName: { type: String, required: true, trim: true, maxlength: DISPLAY_NAME_MAX },
    role: { type: String, enum: ['host', 'member', 'guest'], required: true },
    status: { type: String, enum: ['waiting', 'admitted', 'denied', 'removed'], required: true },
    admittedBy: { type: String, enum: ['auto', 'host'] },
    admittedAt: { type: Date },
    // First time they actually entered the room (lock lets them reconnect after this).
    enteredAt: { type: Date, default: null },
    // Set when the participant's socket leaves; cleared if they reconnect.
    leftAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: 'joinedAt', updatedAt: true } },
);

participantSchema.methods.toPublic = function toPublic() {
  return {
    id: this.id,
    displayName: this.displayName,
    role: this.role,
  };
};

export const Participant = mongoose.model('Participant', participantSchema);
