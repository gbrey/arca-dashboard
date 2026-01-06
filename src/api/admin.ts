import { Env } from '../utils/db';
import { getAuthUser } from './auth';

// Verificar que el usuario sea admin
async function verifyAdmin(env: Env, userId: string): Promise<boolean> {
  const user = await env.DB.prepare(
    'SELECT is_admin FROM users WHERE id = ?'
  ).bind(userId).first<{ is_admin: number }>();
  
  return user?.is_admin === 1;
}

// Obtener todos los usuarios (solo admin)
export async function getUsers(env: Env, userId: string): Promise<Response> {
  try {
    const isAdmin = await verifyAdmin(env, userId);
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: 'No tienes permisos de administrador' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const users = await env.DB.prepare(
      'SELECT id, email, is_admin, is_blocked, created_at FROM users ORDER BY created_at DESC'
    ).all();

    return new Response(JSON.stringify({ 
      users: users.results || []
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Error al obtener usuarios' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Actualizar usuario (bloquear/desbloquear, cambiar contraseña) - solo admin
export async function updateUser(env: Env, adminId: string, targetUserId: string, data: any): Promise<Response> {
  try {
    const isAdmin = await verifyAdmin(env, adminId);
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: 'No tienes permisos de administrador' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const { is_blocked, new_password } = data;
    const updates: string[] = [];
    const values: any[] = [];

    if (typeof is_blocked === 'number') {
      updates.push('is_blocked = ?');
      values.push(is_blocked);
    }

    if (new_password) {
      // Hash de password
      const encoder = new TextEncoder();
      const passwordData = encoder.encode(new_password);
      const hashBuffer = await crypto.subtle.digest('SHA-256', passwordData);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const passwordHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      
      updates.push('password_hash = ?');
      values.push(passwordHash);
    }

    if (updates.length === 0) {
      return new Response(JSON.stringify({ error: 'No hay campos para actualizar' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    values.push(targetUserId);

    await env.DB.prepare(
      `UPDATE users SET ${updates.join(', ')} WHERE id = ?`
    ).bind(...values).run();

    return new Response(JSON.stringify({ 
      success: true,
      message: 'Usuario actualizado correctamente'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error updating user:', error);
    return new Response(JSON.stringify({ error: 'Error al actualizar usuario' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Manejar rutas de admin
export async function handleAdmin(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  
  // Verificar autenticación
  const userId = await getAuthUser(request, env);
  if (!userId) {
    return new Response(JSON.stringify({ error: 'No autorizado' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // GET /api/admin/users - Obtener todos los usuarios
  if (path === '/api/admin/users' && request.method === 'GET') {
    return getUsers(env, userId);
  }

  // PATCH /api/admin/users/:id - Actualizar usuario
  if (path.startsWith('/api/admin/users/') && request.method === 'PATCH') {
    const targetUserId = path.split('/')[4];
    const data = await request.json();
    return updateUser(env, userId, targetUserId, data);
  }

  return new Response(JSON.stringify({ error: 'Ruta no encontrada' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' }
  });
}

