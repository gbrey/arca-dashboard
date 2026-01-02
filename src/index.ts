import { Env } from './utils/db';
import { registerUser, loginUser } from './api/auth';
import { handleInvoices } from './api/invoices';
import { handleLimits } from './api/limits';
import { getArcaAccounts, connectArcaAccount } from './api/accounts';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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
        return new Response(JSON.stringify({ 
          error: 'Error interno del servidor',
          message: error.message 
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }
    
    // Serve static files (for development, in production use Cloudflare Pages)
    // In production, static files should be served by Cloudflare Pages
    if (path === '/' || path === '/index.html') {
      return new Response('Redirect to /index.html', {
        status: 301,
        headers: { 'Location': '/index.html' }
      });
    }
    
    // Default: return 404
    return new Response('Not Found', { status: 404 });
  }
};

async function handleArcaAccounts(request: Request, env: Env): Promise<Response> {
  if (request.method === 'GET' && request.url.includes('/api/arca/accounts')) {
    return getArcaAccounts(request, env);
  }
  
  if (request.method === 'POST' && request.url.includes('/api/arca/connect')) {
    const body = await request.json();
    return connectArcaAccount(request, env, body);
  }
  
  return new Response(JSON.stringify({ error: 'Ruta no encontrada' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' }
  });
}

