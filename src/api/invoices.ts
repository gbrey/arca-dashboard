import { Env, Invoice, generateId } from '../utils/db';
import { getAuthUser } from './auth';
import { getInvoices as getArcaInvoices, createInvoice as createArcaInvoice, updateInvoice as updateArcaInvoice } from './arca';

export async function handleInvoices(request: Request, env: Env): Promise<Response> {
  const userId = await getAuthUser(request, env);
  if (!userId) {
    return new Response(JSON.stringify({ error: 'No autorizado' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  const url = new URL(request.url);
  const pathParts = url.pathname.split('/').filter(p => p);
  
  // GET /api/invoices?account_id=xxx
  if (request.method === 'GET' && pathParts.length === 2) {
    const accountId = url.searchParams.get('account_id');
    if (!accountId) {
      return new Response(JSON.stringify({ error: 'account_id requerido' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Intentar obtener facturas desde ARCA y sincronizar
    // Si falla, usar cache local
    let arcaResponse: Response | null = null;
    try {
      arcaResponse = await getArcaInvoices(env, accountId, userId);
      // Si la respuesta tiene error pero es 500, intentar cache local
      if (!arcaResponse.ok && arcaResponse.status === 500) {
        const errorData = await arcaResponse.json().catch(() => ({}));
        console.error('Error al obtener facturas desde ARCA:', errorData);
        // Continuar para usar cache local
      } else if (!arcaResponse.ok) {
        return arcaResponse;
      }
    } catch (error: any) {
      console.error('Excepción al obtener facturas desde ARCA:', error);
      // Continuar para usar cache local
    }
    
    // Obtener del cache local
    const limit = url.searchParams.get('limit') || '100';
    const invoices = await env.DB.prepare(`
      SELECT * FROM invoices 
      WHERE arca_account_id = ? 
      ORDER BY date DESC 
      LIMIT ?
    `).bind(accountId, parseInt(limit)).all<Invoice>();
    
    // Si no hay facturas en cache y hubo un error, retornar el error
    if (invoices.results.length === 0 && arcaResponse && !arcaResponse.ok) {
      return arcaResponse;
    }
    
    return new Response(JSON.stringify({ 
      invoices: invoices.results,
      cached: invoices.results.length > 0 && (!arcaResponse || !arcaResponse.ok)
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  // POST /api/invoices - Temporalmente deshabilitado, se probará desde desarrollo de AFIP
  if (request.method === 'POST' && pathParts.length === 2) {
    return new Response(JSON.stringify({ error: 'La funcionalidad de emitir facturas está temporalmente deshabilitada. Se probará desde desarrollo de AFIP.' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
    /*
    const body = await request.json() as { account_id: string; amount: number; description: string; date?: string };
    
    if (!body.account_id || !body.amount || !body.description) {
      return new Response(JSON.stringify({ error: 'account_id, amount y description requeridos' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    return createArcaInvoice(env, body.account_id, userId, {
      amount: body.amount,
      description: body.description,
      date: body.date
    });
    */
  }
  
  // PATCH /api/invoices/:id
  if (request.method === 'PATCH' && pathParts.length === 3) {
    const invoiceId = pathParts[2];
    const body = await request.json() as { account_id: string; amount: number };
    
    if (!body.account_id || !body.amount) {
      return new Response(JSON.stringify({ error: 'account_id y amount requeridos' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    return updateArcaInvoice(env, body.account_id, userId, invoiceId, body.amount);
  }
  
  // POST /api/invoices/sync - Sincronización manual de facturas
  if (request.method === 'POST' && pathParts.length === 3 && pathParts[2] === 'sync') {
    const body = await request.json() as { account_id: string; year?: number };
    
    if (!body.account_id) {
      return new Response(JSON.stringify({ error: 'account_id requerido' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    return syncInvoices(env, body.account_id, userId, body.year);
  }
  
  return new Response(JSON.stringify({ error: 'Ruta no encontrada' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' }
  });
}

// Función para sincronizar facturas manualmente (siempre usa automatización)
async function syncInvoices(
  env: Env,
  accountId: string,
  userId: string,
  year?: number
): Promise<Response> {
  try {
    // Importar función de ARCA
    const { syncInvoicesFromArca } = await import('./arca');
    // Siempre usar automatización, con año opcional
    return await syncInvoicesFromArca(env, accountId, userId, true, year);
  } catch (error: any) {
    return new Response(JSON.stringify({ 
      error: error.message || 'Error al sincronizar facturas' 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

