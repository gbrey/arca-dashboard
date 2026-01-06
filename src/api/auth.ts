import { sign, verify, decode } from '@tsndr/cloudflare-worker-jwt';
import { Env, generateId, getCurrentTimestamp } from '../utils/db';
import { encrypt } from '../utils/encryption';

export interface AuthRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
}

// Hash simple de password (en producción usar bcrypt o similar)
async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const passwordHash = await hashPassword(password);
  return passwordHash === hash;
}

export async function registerUser(env: Env, request: RegisterRequest): Promise<Response> {
  try {
    // Verificar si el usuario ya existe
    const existing = await env.DB.prepare(
      'SELECT id FROM users WHERE email = ?'
    ).bind(request.email).first();
    
    if (existing) {
      return new Response(JSON.stringify({ error: 'Email ya registrado' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Crear nuevo usuario
    const userId = generateId();
    const passwordHash = await hashPassword(request.password);
    const timestamp = getCurrentTimestamp();
    
    await env.DB.prepare(
      'INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)'
    ).bind(userId, request.email, passwordHash, timestamp).run();
    
    // Generar JWT
    const token = await generateToken(env, userId);
    
    return new Response(JSON.stringify({ 
      success: true, 
      token,
      user: { id: userId, email: request.email }
    }), {
      status: 201,
      headers: { 
        'Content-Type': 'application/json',
        'Set-Cookie': `token=${token}; HttpOnly; Secure; SameSite=Strict; Path=/`
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Error al registrar usuario' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function loginUser(env: Env, request: AuthRequest): Promise<Response> {
  try {
    const user = await env.DB.prepare(
      'SELECT id, email, password_hash, COALESCE(is_admin, 0) as is_admin, COALESCE(is_blocked, 0) as is_blocked FROM users WHERE email = ?'
    ).bind(request.email).first<{ 
      id: string; 
      email: string; 
      password_hash: string; 
      is_admin: number | null;
      is_blocked: number | null;
    }>();
    
    if (!user) {
      return new Response(JSON.stringify({ error: 'Credenciales inválidas' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Verificar si el usuario está bloqueado (manejar null como 0)
    const isBlocked = user.is_blocked === 1 || user.is_blocked === true;
    if (isBlocked) {
      return new Response(JSON.stringify({ error: 'Usuario bloqueado. Contacta al administrador.' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const isValid = await verifyPassword(request.password, user.password_hash);
    if (!isValid) {
      return new Response(JSON.stringify({ error: 'Credenciales inválidas' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const token = await generateToken(env, user.id);
    
    // Manejar null como false para is_admin
    const isAdmin = user.is_admin === 1 || user.is_admin === true;
    
    return new Response(JSON.stringify({ 
      success: true, 
      token,
      user: { 
        id: user.id, 
        email: user.email,
        is_admin: isAdmin
      }
    }), {
      status: 200,
      headers: { 
        'Content-Type': 'application/json',
        'Set-Cookie': `token=${token}; HttpOnly; Secure; SameSite=Strict; Path=/`
      }
    });
  } catch (error) {
    console.error('[Login] Error:', error);
    console.error('[Login] Error details:', error instanceof Error ? error.message : String(error));
    return new Response(JSON.stringify({ 
      error: 'Error al iniciar sesión',
      details: error instanceof Error ? error.message : String(error)
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function generateToken(env: Env, userId: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    userId,
    iat: now,
    exp: now + (30 * 24 * 60 * 60) // 30 días
  };
  return await sign(payload, env.JWT_SECRET, { algorithm: 'HS256' });
}

export async function verifyToken(env: Env, token: string): Promise<{ userId: string } | null> {
  try {
    const isValid = await verify(token, env.JWT_SECRET, { algorithm: 'HS256' });
    if (!isValid) {
      return null;
    }
    const decoded = decode<{ userId: string }>(token);
    return { userId: decoded.payload?.userId as string };
  } catch {
    return null;
  }
}

export async function getAuthUser(request: Request, env: Env): Promise<string | null> {
  // Intentar obtener token del header Authorization
  const authHeader = request.headers.get('Authorization');
  let token: string | null = null;
  
  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else {
    // Intentar obtener de cookies
    const cookieHeader = request.headers.get('Cookie');
    if (cookieHeader) {
      const cookies = cookieHeader.split(';').map(c => c.trim());
      const tokenCookie = cookies.find(c => c.startsWith('token='));
      if (tokenCookie) {
        token = tokenCookie.slice(6);
      }
    }
  }
  
  if (!token) {
    return null;
  }
  
  const verified = await verifyToken(env, token);
  return verified?.userId || null;
}

export interface ResetPasswordRequest {
  current_password: string;
  new_password: string;
}

export async function resetPassword(env: Env, userId: string, request: ResetPasswordRequest): Promise<Response> {
  try {
    // Obtener usuario actual
    const user = await env.DB.prepare(
      'SELECT id, password_hash FROM users WHERE id = ?'
    ).bind(userId).first<{ id: string; password_hash: string }>();
    
    if (!user) {
      return new Response(JSON.stringify({ error: 'Usuario no encontrado' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Verificar contraseña actual
    const isValid = await verifyPassword(request.current_password, user.password_hash);
    if (!isValid) {
      return new Response(JSON.stringify({ error: 'Contraseña actual incorrecta' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Validar nueva contraseña
    if (!request.new_password || request.new_password.length < 6) {
      return new Response(JSON.stringify({ error: 'La nueva contraseña debe tener al menos 6 caracteres' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Actualizar contraseña
    const newPasswordHash = await hashPassword(request.new_password);
    await env.DB.prepare(
      'UPDATE users SET password_hash = ? WHERE id = ?'
    ).bind(newPasswordHash, userId).run();
    
    return new Response(JSON.stringify({ 
      success: true,
      message: 'Contraseña actualizada correctamente'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Error al actualizar contraseña' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

