import mongoose from 'mongoose';

export const USER_NAME_MAX = 40;

const userSchema = new mongoose.Schema(
  {
    // Stored lowercase + trimmed so "Ada@X.com" and "ada@x.com" are one account.
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true, maxlength: USER_NAME_MAX },
    passwordHash: { type: String, required: true, select: false },
  },
  { timestamps: true },
);

userSchema.methods.toPublic = function toPublic() {
  return { id: this.id, email: this.email, name: this.name, createdAt: this.createdAt };
};

export const User = mongoose.model('User', userSchema);
