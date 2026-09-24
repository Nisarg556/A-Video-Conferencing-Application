import mongoose from 'mongoose';

export const DISPLAY_NAME_MAX = 40;

// One document per successful join. Durable history for debugging and, later,
// chat attribution — live presence is tracked in memory by RoomManager.
const participantSchema = new mongoose.Schema(
  {
    meetingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Meeting', required: true, index: true },
    displayName: { type: String, required: true, trim: true, maxlength: DISPLAY_NAME_MAX },
    role: { type: String, enum: ['host', 'guest'], required: true },
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
