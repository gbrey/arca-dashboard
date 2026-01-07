import { Env } from '../../src/utils/db';
import { registerUser, loginUser, resetPassword } from '../../src/api/auth';
import { handleInvoices } from '../../src/api/invoices';
import { handleLimits } from '../../src/api/limits';
import { handleRecategorization } from '../../src/api/recategorization';
import { handleAdmin } from '../../src/api/admin';
import { 
  getArcaAccounts, 
  getArcaAccount, 
  updateArcaAccount, 
  connectArcaAccount,
  setDefaultAccount 
} from '../../src/api/accounts';

export async function onRequest(context: any): Promise<Response> {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;
  
  // DEBUG: Log inicial
  console.log('[DEBUG] Function called - Request:', {
    method: request.method,
    url: request.url,
    pathname: path,
    hasDB: !!env?.DB,
    hasEnvVars: {
      ENCRYPTION_KEY: !!env?.ENCRYPTION_KEY,
      JWT_SECRET: !!env?.JWT_SECRET,
      AFIP_SDK_API_KEY: !!env?.AFIP_SDK_API_KEY,
      TUSFACTURAS_API_KEY: !!env?.TUSFACTURAS_API_KEY
    }
  });
  
  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };
  
  // Handle preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  
  // API Routes
  if (path.startsWith('/api/')) {
    let response: Response;
    
    try {
      // Auth routes
      if (path === '/api/auth/register' && request.method === 'POST') {
        const body = await request.json();
        response = await registerUser(env, body);
      } else if (path === '/api/auth/login' && request.method === 'POST') {
        const body = await request.json();
        response = await loginUser(env, body);
      } else if (path === '/api/auth/reset-password' && request.method === 'POST') {
        const userId = await getAuthUser(request, env);
        if (!userId) {
          response = new Response(JSON.stringify({ error: 'No autorizado' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
          });
        } else {
          const body = await request.json();
          response = await resetPassword(env, userId, body);
        }
      }
      // Invoice routes
      else if (path.startsWith('/api/invoices')) {
        response = await handleInvoices(request, env);
      }
      // Limits routes
      else if (path.startsWith('/api/limits')) {
        response = await handleLimits(request, env);
      }
      // Recategorization routes
      else if (path.startsWith('/api/recategorization')) {
        response = await handleRecategorization(request, env);
      }
      // Admin routes
      else if (path.startsWith('/api/admin')) {
        response = await handleAdmin(request, env);
      }
      // ARCA account routes
      else if (path.startsWith('/api/arca')) {
        response = await handleArcaAccounts(request, env);
      }
      else {
        response = new Response(JSON.stringify({ error: 'Ruta no encontrada' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
      
      // Agregar CORS headers a la respuesta
      const newHeaders = new Headers(response.headers);
      Object.entries(corsHeaders).forEach(([key, value]) => {
        newHeaders.set(key, value);
      });
      
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders
      });
    } catch (error: any) {
      console.error('[ERROR] API route error:', error);
      return new Response(JSON.stringify({ 
        error: 'Error interno del servidor',
        message: error.message 
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
  }
  
  // Default: return 404
  return new Response('Not Found', { status: 404 });
}

async function handleArcaAccounts(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  
  // GET /api/arca/accounts
  if (path === '/api/arca/accounts' && request.method === 'GET') {
    return getArcaAccounts(request, env);
  }
  
  // GET /api/arca/accounts/:id
  if (path.startsWith('/api/arca/accounts/') && request.method === 'GET') {
    const accountId = path.split('/')[4];
    return getArcaAccount(request, env, accountId);
  }
  
  // POST /api/arca/connect
  if (path === '/api/arca/connect' && request.method === 'POST') {
    const body = await request.json();
    return connectArcaAccount(request, env, body);
  }
  
  // PATCH /api/arca/accounts/:id
  if (path.startsWith('/api/arca/accounts/') && request.method === 'PATCH') {
    const accountId = path.split('/')[4];
    const body = await request.json();
    return updateArcaAccount(request, env, accountId, body);
  }
  
  // POST /api/arca/accounts/:id/set-default
  if (path.includes('/set-default') && request.method === 'POST') {
    const accountId = path.split('/')[4];
    return setDefaultAccount(request, env, accountId);
  }
  
  return new Response(JSON.stringify({ error: 'Ruta no encontrada' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' }
  });
}

// Helper function para obtener usuario autenticado
async function getAuthUser(request: Request, env: Env): Promise<string | null> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  
  const token = authHeader.substring(7);
  const { verifyToken } = await import('../../src/api/auth');
  const result = await verifyToken(env, token);
  return result?.userId || null;
}
