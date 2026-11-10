import { sql } from './schema';
import bcrypt from 'bcryptjs';

export async function createUser(email: string, password: string, name?: string, role: 'user' | 'admin' = 'user') {
  const password_hash = await bcrypt.hash(password, 12);
  const [user] = await sql`
    INSERT INTO users (email, password_hash, name, role)
    VALUES (${email.toLowerCase()}, ${password_hash}, ${name || null}, ${role})
    ON CONFLICT (email) DO UPDATE SET
      password_hash = EXCLUDED.password_hash,
      name = COALESCE(EXCLUDED.name, users.name),
      role = EXCLUDED.role,
      updated_at = NOW()
    RETURNING id, email, name, role, is_active, created_at;
  `;
  return user;
}

export async function getUserByEmail(email: string) {
  const [user] = await sql`
    SELECT id, email, password_hash, name, role, is_active, created_at
    FROM users WHERE email = ${email.toLowerCase()}
  `;
  return user;
}

export async function getUserById(id: string) {
  const [user] = await sql`
    SELECT id, email, name, role, is_active, created_at
    FROM users WHERE id = ${id}
  `;
  return user;
}

export async function verifyPassword(user: { password_hash: string }, password: string) {
  return bcrypt.compare(password, user.password_hash);
}

export async function listUsers() {
  return sql`
    SELECT id, email, name, role, is_active, created_at
    FROM users ORDER BY created_at DESC
  `;
}

export async function updateUserStatus(userId: string, isActive: boolean) {
  const [user] = await sql`
    UPDATE users SET is_active = ${isActive}, updated_at = NOW()
    WHERE id = ${userId}
    RETURNING id, email, name, role, is_active, created_at
  `;
  return user;
}

export async function deleteUser(userId: string) {
  await sql`DELETE FROM users WHERE id = ${userId}`;
}

export async function getUserSessions(userId: string) {
  return sql`
    SELECT id, title, model_id, created_at, updated_at
    FROM chat_sessions WHERE user_id = ${userId}
    ORDER BY updated_at DESC
  `;
}

export async function createSession(userId: string, title: string, modelId: string) {
  const [session] = await sql`
    INSERT INTO chat_sessions (user_id, title, model_id)
    VALUES (${userId}, ${title}, ${modelId})
    RETURNING id, title, model_id, created_at, updated_at
  `;
  return session;
}

export async function getSession(sessionId: string) {
  const [session] = await sql`
    SELECT id, user_id, title, model_id, created_at, updated_at
    FROM chat_sessions WHERE id = ${sessionId}
  `;
  return session;
}

export async function saveMessage(sessionId: string, role: string, content: string, modelId?: string) {
  await sql`
    INSERT INTO messages (session_id, role, content, model_id)
    VALUES (${sessionId}, ${role}, ${content}, ${modelId || null})
  `;
  await sql`
    UPDATE chat_sessions SET updated_at = NOW() WHERE id = ${sessionId}
  `;
}

export async function getMessages(sessionId: string) {
  return sql`
    SELECT id, role, content, model_id, created_at
    FROM messages WHERE session_id = ${sessionId}
    ORDER BY created_at ASC
  `;
}