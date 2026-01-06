import { Env } from '../../src/utils/db';
import { registerUser, loginUser, getAuthUser } from '../../src/api/auth';
import { handleInvoices } from '../../src/api/invoices';
import { handleLimits } from '../../src/api/limits';
import { handleRecategorization } from '../../src/api/recategorization';
import { getArcaAccounts, connectArcaAccount, getArcaAccount, updateArcaAccount, setDefaultAccount } from '../../src/api/accounts';
import { getProductionCertificate, registerCuitInAfipSdk } from '../../src/api/certificates';

export const onRequest = async (context: { request: Request; env: Env }) => {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;
  
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
      // ARCA account routes
      else if (path.startsWith('/api/arca')) {
        response = await handleArcaAccounts(request, env);
      }
      // Certificate routes
      else if (path.startsWith('/api/certificates')) {
        response = await handleCertificates(request, env);
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
};

async function handleArcaAccounts(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const pathParts = url.pathname.split('/').filter(p => p);
  
  // GET /api/arca/accounts - Listar todas las cuentas
  if (request.method === 'GET' && pathParts.length === 3 && pathParts[2] === 'accounts') {
    return getArcaAccounts(request, env);
  }
  
  // GET /api/arca/accounts/:id - Obtener una cuenta específica
  if (request.method === 'GET' && pathParts.length === 4 && pathParts[2] === 'accounts') {
    const accountId = pathParts[3];
    return getArcaAccount(request, env, accountId);
  }
  
  // PATCH /api/arca/accounts/:id - Actualizar una cuenta
  if (request.method === 'PATCH' && pathParts.length === 4 && pathParts[2] === 'accounts') {
    const accountId = pathParts[3];
    const body = await request.json();
    return updateArcaAccount(request, env, accountId, body);
  }
  
  // POST /api/arca/connect - Conectar nueva cuenta
  if (request.method === 'POST' && pathParts.length === 3 && pathParts[2] === 'connect') {
    const body = await request.json();
    return connectArcaAccount(request, env, body);
  }
  
  // POST /api/arca/accounts/:id/set-default - Marcar cuenta como default
  if (request.method === 'POST' && pathParts.length === 5 && pathParts[2] === 'accounts' && pathParts[4] === 'set-default') {
    const accountId = pathParts[3];
    return setDefaultAccount(request, env, accountId);
  }
  
  return new Response(JSON.stringify({ error: 'Ruta no encontrada' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' }
  });
}

async function handleCertificates(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const accountId = url.searchParams.get('account_id');
  
  if (!accountId) {
    return new Response(JSON.stringify({ error: 'account_id requerido' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  if (request.method === 'POST' && path.includes('/api/certificates/obtain')) {
    // Obtener userId del token
    const userId = await getAuthUser(request, env);
    if (!userId) {
      return new Response(JSON.stringify({ error: 'No autorizado' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    return getProductionCertificate(env, accountId, userId);
  }
  
  // POST /api/certificates/register-cuit - Dar de alta CUIT en AFIP SDK
  if (request.method === 'POST' && path.includes('/api/certificates/register-cuit')) {
    const userId = await getAuthUser(request, env);
    if (!userId) {
      return new Response(JSON.stringify({ error: 'No autorizado' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    return registerCuitInAfipSdk(env, accountId, userId);
  }
  
  return new Response(JSON.stringify({ error: 'Ruta no encontrada' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' }
  });
}

