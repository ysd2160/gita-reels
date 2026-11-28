import { AsyncLocalStorage } from 'node:async_hooks';
import mongoose from 'mongoose';

// Who is running right now? Every request and every background job runs inside runAs(user, fn).
// The tenant plugin (tenancy.js) reads this to scope EVERY database query to that user.
// runAs(null, fn) = "system" (no user): used only by startup / cleanup code that must see all users.
const als = new AsyncLocalStorage();

export function runAs(user, fn) {
  if (!user) return als.run({ userId: null, system: true }, fn);
  const id = user._id || user.id || user;
  return als.run({ userId: new mongoose.Types.ObjectId(String(id)), isAdmin: !!user.isAdmin, name: user.name || '', email: user.email || '' }, fn);
}
export const currentUserId = () => als.getStore()?.userId || null;
export const currentUser = () => als.getStore() || null;
export const isAdminCtx = () => !!als.getStore()?.isAdmin;
