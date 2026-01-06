import { Env, ArcaAccount, Invoice } from '../utils/db';
import { decrypt } from '../utils/encryption';

// Cliente genérico para APIs de ARCA (AFIP SDK o TusFacturasApp)
export interface ArcaInvoice {
  id: string;
  arca_invoice_id?: string;
  number: string;
  amount: number;
  date: string;
  description: string;
  status: string;
  cae?: string | null;
  receptor?: string | null;
  tipo?: string | null;
  cuit?: string | null;
  cached_data?: string | null;
}

export interface CreateInvoiceRequest {
  amount: number;
  description: string;
  date?: string;
}

// Obtener cuenta ARCA y desencriptar API key
async function getArcaAccount(env: Env, accountId: string, userId: string): Promise<ArcaAccount | null> {
  const account = await env.DB.prepare(
    'SELECT * FROM arca_accounts WHERE id = ? AND user_id = ?'
  ).bind(accountId, userId).first<ArcaAccount>();
  
  return account;
}

// Desencriptar credenciales de cuenta ARCA
export async function getDecryptedCredentials(env: Env, account: ArcaAccount): Promise<{ accessToken: string }> {
  const { decrypt } = await import('../utils/encryption');
  // Para AFIP SDK, usamos api_key_encrypted como access token
  // Si hay api_token_encrypted, tiene prioridad
  let accessToken: string;
  
  if (account.api_token_encrypted) {
    accessToken = await decrypt(account.api_token_encrypted, env.ENCRYPTION_KEY);
  } else {
    accessToken = await decrypt(account.api_key_encrypted, env.ENCRYPTION_KEY);
  }
  
  return { accessToken };
}

// Listar automatizaciones disponibles en AFIP SDK
export async function listAfipSdkAutomations(accessToken: string): Promise<string[]> {
  try {
    const url = 'https://app.afipsdk.com/api/v1/automations';
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });
    
    console.log(`[AFIP SDK] GET ${url} - Status: ${response.status}`);
    
    if (response.ok) {
      const data = await response.json();
      console.log(`[AFIP SDK] Respuesta de listar automatizaciones:`, JSON.stringify(data).substring(0, 500));
      
      // Si devuelve un array de automatizaciones
      if (Array.isArray(data)) {
        const names = data.map((a: any) => a.name || a.id || a).filter(Boolean);
        console.log(`[AFIP SDK] Encontradas ${names.length} automatizaciones:`, names);
        return names;
      }
      // Si devuelve un objeto con automatizaciones
      if (data.automations && Array.isArray(data.automations)) {
        const names = data.automations.map((a: any) => a.name || a.id || a).filter(Boolean);
        console.log(`[AFIP SDK] Encontradas ${names.length} automatizaciones en data.automations:`, names);
        return names;
      }
      // Si devuelve un objeto con otra estructura
      if (data.data && Array.isArray(data.data)) {
        const names = data.data.map((a: any) => a.name || a.id || a).filter(Boolean);
        console.log(`[AFIP SDK] Encontradas ${names.length} automatizaciones en data.data:`, names);
        return names;
      }
      
      console.log(`[AFIP SDK] Estructura de respuesta no reconocida:`, Object.keys(data));
    } else {
      const errorText = await response.text();
      console.log(`[AFIP SDK] Error al listar automatizaciones (${response.status}):`, errorText.substring(0, 200));
    }
  } catch (error: any) {
    console.log('[AFIP SDK] Excepción al listar automatizaciones:', error.message);
  }
  return [];
}

// Cliente para AFIP SDK - Usa automatizaciones
export async function callAfipSdkAutomation(
  automationName: string,
  accessToken: string,
  params: any
): Promise<any> {
  const url = 'https://app.afipsdk.com/api/v1/automations';
  
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${accessToken}`
  };
  
  const body = {
    automation: automationName,
    params: params
  };
  
  // Crear automatización
  const createResponse = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  
  if (!createResponse.ok) {
    const errorText = await createResponse.text();
    let errorMessage = `AFIP SDK API error (${createResponse.status}): ${errorText.substring(0, 200)}`;
    try {
      const errorJson = JSON.parse(errorText);
      errorMessage = errorJson.message || errorJson.error || errorMessage;
      
      // Si el error indica que la automatización es inválida, proporcionar más contexto
      if (errorJson.data_errors?.automation || errorMessage.includes('invalido') || errorMessage.includes('invalid')) {
        errorMessage = `Automatización "${automationName}" no existe o no está disponible. Error: ${errorText}`;
      }
      
      // Si es "MethodNotAllowed", el endpoint puede ser incorrecto
      if (errorJson.code === 'MethodNotAllowed' || createResponse.status === 405) {
        errorMessage = `AFIP SDK: El endpoint de automatizaciones no acepta POST. Verifica la documentación de la API. Error: ${errorJson.message || errorText}`;
      }
    } catch {
      if (errorText.includes('<!DOCTYPE') || errorText.includes('<html')) {
        errorMessage = `AFIP SDK: Token inválido o endpoint no encontrado.`;
      } else if (errorText.includes('MethodNotAllowed')) {
        errorMessage = `AFIP SDK: El endpoint no acepta POST. Puede que necesites usar un método diferente o verificar la documentación de la API.`;
      }
    }
    throw new Error(errorMessage);
  }
  
  const automation: any = await createResponse.json();
  const automationId = automation.id || automation.automation_id;
  
  if (!automationId) {
    throw new Error('AFIP SDK: No se pudo obtener el ID de la automatización');
  }
  
  // Esperar a que la automatización se complete (polling)
  let attempts = 0;
  const maxAttempts = 60; // 5 minutos máximo (5 segundos * 60)
  
  while (attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 5000)); // Esperar 5 segundos
    
    const statusResponse = await fetch(`${url}/${automationId}`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });
    
    if (!statusResponse.ok) {
      throw new Error(`Error al consultar estado de automatización: ${statusResponse.statusText}`);
    }
    
    const status: any = await statusResponse.json();
    
    if (status.status === 'complete' || status.status === 'completed' || status.status === 'success') {
      return status.data || status.result || status;
    }
    
    if (status.status === 'failed' || status.status === 'error') {
      throw new Error(`Automatización falló: ${status.error || status.message || 'Error desconocido'}`);
    }
    
    attempts++;
  }
  
  throw new Error('Timeout: La automatización tardó demasiado en completarse');
}

// Cliente genérico para AFIP SDK (mantener para compatibilidad)
async function callAfipSdk(
  endpoint: string,
  method: string,
  accessToken: string,
  body?: any
): Promise<any> {
  const baseUrl = 'https://app.afipsdk.com/api/v1';
  const url = `${baseUrl}${endpoint}`;
  
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${accessToken}`
  };
  
  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage = `AFIP SDK API error (${response.status}): ${errorText.substring(0, 200)}`;
    try {
      const errorJson = JSON.parse(errorText);
      errorMessage = errorJson.message || errorJson.error || errorMessage;
    } catch {
      if (errorText.includes('<!DOCTYPE') || errorText.includes('<html')) {
        errorMessage = `AFIP SDK: Endpoint no encontrado o token inválido.`;
      }
    }
    throw new Error(errorMessage);
  }
  
  const responseText = await response.text();
  
  if (responseText.includes('<!DOCTYPE') || responseText.includes('<html')) {
    throw new Error('AFIP SDK: Respuesta HTML recibida. Verifica que el endpoint sea correcto.');
  }
  
  try {
    return JSON.parse(responseText);
  } catch {
    throw new Error(`AFIP SDK: Respuesta no es JSON válido: ${responseText.substring(0, 200)}`);
  }
}

// Cliente para Web Services directos de AFIP SDK (sin automatizaciones)
async function callAfipSdkWebService(
  webService: string,
  method: string,
  accessToken: string,
  params: any
): Promise<any> {
  const baseUrl = 'https://app.afipsdk.com/api/v1';
  const url = `${baseUrl}/resources/${webService}/${method}`;
  
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${accessToken}`
  };
  
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(params)
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage = `AFIP SDK Web Service error (${response.status}): ${errorText.substring(0, 200)}`;
    try {
      const errorJson = JSON.parse(errorText);
      errorMessage = errorJson.message || errorJson.error || errorMessage;
    } catch {
      if (errorText.includes('<!DOCTYPE') || errorText.includes('<html')) {
        errorMessage = `AFIP SDK: Web service no disponible o token inválido.`;
      }
    }
    throw new Error(errorMessage);
  }
  
  const responseText = await response.text();
  
  if (responseText.includes('<!DOCTYPE') || responseText.includes('<html')) {
    throw new Error('AFIP SDK: Respuesta HTML recibida. Verifica que el web service esté disponible.');
  }
  
  try {
    return JSON.parse(responseText);
  } catch {
    throw new Error(`AFIP SDK: Respuesta no es JSON válido: ${responseText.substring(0, 200)}`);
  }
}


// Cliente para TusFacturasApp
async function callTusFacturas(
  endpoint: string,
  method: string,
  accessToken: string,
  body?: any
): Promise<any> {
  const url = `https://api.tusfacturas.app/v1${endpoint}`;
  const headers: HeadersInit = {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  };
  
  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`TusFacturas API error: ${error}`);
  }
  
  return response.json();
}

export async function getInvoices(env: Env, accountId: string, userId: string): Promise<Response> {
  try {
    const account = await getArcaAccount(env, accountId, userId);
    if (!account) {
      return new Response(JSON.stringify({ error: 'Cuenta ARCA no encontrada' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Primero, obtener TODAS las facturas del cache
    const cachedInvoices = await env.DB.prepare(`
      SELECT * FROM invoices 
      WHERE arca_account_id = ?
      ORDER BY date DESC
    `).bind(accountId).all<Invoice>();
    
    // Convertir facturas del cache al formato esperado
    const cachedInvoicesMap = new Map<string, ArcaInvoice>();
    if (cachedInvoices.results && cachedInvoices.results.length > 0) {
      cachedInvoices.results.forEach(inv => {
        // Intentar parsear cached_data para obtener campos adicionales
        let cachedData: any = {};
        try {
          if (inv.cached_data) {
            cachedData = JSON.parse(inv.cached_data);
          }
        } catch (e) {
          // Si no se puede parsear, usar valores por defecto
        }
        
        cachedInvoicesMap.set(inv.arca_invoice_id, {
          id: inv.arca_invoice_id,
          arca_invoice_id: inv.arca_invoice_id,
          number: inv.arca_invoice_id,
          amount: inv.amount,
          date: new Date(inv.date * 1000).toISOString(),
          description: inv.description || '',
          status: cachedData.status || 'authorized',
          cae: cachedData.cae || null,
          receptor: cachedData.receptor || null,
          tipo: cachedData.tipo || null,
          cuit: cachedData.cuit || null,
          cached_data: inv.cached_data
        });
      });
    }
    
    // NO usamos automatizaciones para obtener facturas automáticamente
    // Solo usamos el cache existente
    // Las facturas nuevas se obtendrán manualmente cuando el usuario lo solicite
    let newInvoices: ArcaInvoice[] = [];
    
    // Para otros proveedores (TusFacturas), sí podemos obtener facturas directamente
    if (account.provider === 'tusfacturas') {
      const { accessToken } = await getDecryptedCredentials(env, account);
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 10);
      const data = await callTusFacturas('/invoices', 'GET', accessToken);
      const allInvoices = data.invoices || [];
      const tenDaysAgo = startDate.getTime();
      newInvoices = allInvoices.filter((inv: ArcaInvoice) => {
        const invDate = new Date(inv.date).getTime();
        return invDate >= tenDaysAgo;
      });
    }
    
    // Para AFIP SDK, no ejecutamos automatizaciones automáticamente
    // El usuario debe usar la función manual de sincronización si necesita nuevas facturas
    
    // Actualizar cache solo con facturas nuevas (que no están en cache)
    const invoicesToCache: ArcaInvoice[] = [];
    for (const invoice of newInvoices) {
      if (!cachedInvoicesMap.has(invoice.id)) {
        invoicesToCache.push(invoice);
        // Agregar al mapa para incluirlo en la respuesta
        cachedInvoicesMap.set(invoice.id, invoice);
      } else {
        // Actualizar factura existente si hay cambios
        const existing = cachedInvoicesMap.get(invoice.id);
        if (existing && (existing.amount !== invoice.amount || existing.description !== invoice.description)) {
          invoicesToCache.push(invoice);
          cachedInvoicesMap.set(invoice.id, invoice);
        }
      }
    }
    
    // Guardar solo las facturas nuevas en el cache
    // Primero verificar si ya existe para evitar duplicados
    for (const invoice of invoicesToCache) {
      // Buscar si ya existe una factura con este arca_invoice_id
      const existing = await env.DB.prepare(`
        SELECT id FROM invoices 
        WHERE arca_account_id = ? AND arca_invoice_id = ?
        LIMIT 1
      `).bind(accountId, invoice.id).first<{ id: string }>();
      
      if (existing) {
        // Actualizar factura existente
        await env.DB.prepare(`
          UPDATE invoices 
          SET amount = ?, date = ?, description = ?, cached_data = ?, updated_at = ?
          WHERE id = ?
        `).bind(
          invoice.amount,
          Math.floor(new Date(invoice.date).getTime() / 1000),
          invoice.description,
          JSON.stringify(invoice),
          Math.floor(Date.now() / 1000),
          existing.id
        ).run();
      } else {
        // Insertar nueva factura
        await env.DB.prepare(`
          INSERT INTO invoices 
          (id, arca_account_id, arca_invoice_id, amount, date, description, cached_data, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          generateId(),
          accountId,
          invoice.id,
          invoice.amount,
          Math.floor(new Date(invoice.date).getTime() / 1000),
          invoice.description,
          JSON.stringify(invoice),
          Math.floor(Date.now() / 1000),
          Math.floor(Date.now() / 1000)
        ).run();
      }
    }
    
    // Combinar todas las facturas (cache + nuevas) y ordenar por fecha
    const allInvoices = Array.from(cachedInvoicesMap.values())
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    
    return new Response(JSON.stringify({ invoices: allInvoices }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message || 'Error al obtener facturas' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function createInvoice(
  env: Env,
  accountId: string,
  userId: string,
  request: CreateInvoiceRequest
): Promise<Response> {
  try {
    const account = await getArcaAccount(env, accountId, userId);
    if (!account) {
      return new Response(JSON.stringify({ error: 'Cuenta ARCA no encontrada' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const { accessToken } = await getDecryptedCredentials(env, account);
    
    let invoice: ArcaInvoice;
    if (account.provider === 'afip_sdk') {
      invoice = await callAfipSdk('/invoices', 'POST', accessToken, {
        amount: request.amount,
        description: request.description,
        date: request.date || new Date().toISOString().split('T')[0]
      });
    } else {
      invoice = await callTusFacturas('/invoices', 'POST', accessToken, {
        amount: request.amount,
        description: request.description,
        date: request.date || new Date().toISOString().split('T')[0]
      });
    }
    
    // Guardar en cache local
    await env.DB.prepare(`
      INSERT INTO invoices 
      (id, arca_account_id, arca_invoice_id, amount, date, description, cached_data, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      generateId(),
      accountId,
      invoice.id,
      invoice.amount,
      Math.floor(new Date(invoice.date).getTime() / 1000),
      invoice.description,
      JSON.stringify(invoice),
      Math.floor(Date.now() / 1000),
      Math.floor(Date.now() / 1000)
    ).run();
    
    return new Response(JSON.stringify({ invoice }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message || 'Error al crear factura' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function updateInvoice(
  env: Env,
  accountId: string,
  userId: string,
  invoiceId: string,
  amount: number
): Promise<Response> {
  try {
    const account = await getArcaAccount(env, accountId, userId);
    if (!account) {
      return new Response(JSON.stringify({ error: 'Cuenta ARCA no encontrada' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const { accessToken } = await getDecryptedCredentials(env, account);
    
    let invoice: ArcaInvoice;
    if (account.provider === 'afip_sdk') {
      invoice = await callAfipSdk(`/invoices/${invoiceId}`, 'PATCH', accessToken, { amount });
    } else {
      invoice = await callTusFacturas(`/invoices/${invoiceId}`, 'PATCH', accessToken, { amount });
    }
    
    // Actualizar cache local
    await env.DB.prepare(`
      UPDATE invoices 
      SET amount = ?, cached_data = ?, updated_at = ?
      WHERE arca_invoice_id = ? AND arca_account_id = ?
    `).bind(
      invoice.amount,
      JSON.stringify(invoice),
      Math.floor(Date.now() / 1000),
      invoiceId,
      accountId
    ).run();
    
    return new Response(JSON.stringify({ invoice }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message || 'Error al actualizar factura' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Función para sincronizar facturas manualmente (solo cuando el usuario lo solicite)
export async function syncInvoicesFromArca(
  env: Env,
  accountId: string,
  userId: string,
  useAutomation: boolean, // Mantener por compatibilidad pero siempre será true
  year?: number // Año específico para sincronizar (opcional)
): Promise<Response> {
  try {
    const account = await getArcaAccount(env, accountId, userId);
    if (!account) {
      return new Response(JSON.stringify({ error: 'Cuenta ARCA no encontrada' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const { accessToken } = await getDecryptedCredentials(env, account);
    let newInvoices: ArcaInvoice[] = [];
    
    if (account.provider === 'afip_sdk') {
      const { decrypt } = await import('../utils/encryption');
      
      // Siempre usar automatización para obtener comprobantes
      console.log(`[Sync] 🔄 Usando automatización para obtener comprobantes...`);
      
      if (!account.cuit || !account.afip_username_encrypted || !account.afip_password_encrypted) {
        return new Response(JSON.stringify({ 
          error: 'Faltan credenciales de AFIP para usar automatización' 
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      try {
        const afipUsername = await decrypt(account.afip_username_encrypted, env.ENCRYPTION_KEY);
        const afipPassword = await decrypt(account.afip_password_encrypted, env.ENCRYPTION_KEY);
        
        let startDate: Date;
        let endDate: Date;
        
        if (year) {
          // Si se especifica un año, sincronizar todo ese año
          startDate = new Date(year, 0, 1); // 1 de enero
          endDate = new Date(year, 11, 31); // 31 de diciembre
          
          // Si el año es el actual, usar hasta hoy
          const today = new Date();
          if (year === today.getFullYear() && endDate > today) {
            endDate = today;
          }
          
          console.log(`[Sync] 📅 Sincronizando año ${year}: ${startDate.toISOString().split('T')[0]} - ${endDate.toISOString().split('T')[0]}`);
        } else {
          // Comportamiento por defecto: basado en facturas cacheadas
          const lastInvoice = await env.DB.prepare(`
            SELECT date FROM invoices 
            WHERE arca_account_id = ?
            ORDER BY date DESC
            LIMIT 1
          `).bind(accountId).first<{ date: number }>();
          
          endDate = new Date();
          
          if (lastInvoice && lastInvoice.date) {
            // Si hay facturas, usar desde la fecha más reciente (inclusive)
            startDate = new Date(lastInvoice.date * 1000); // Convertir timestamp (segundos) a Date
            console.log(`[Sync] 📅 Facturas cacheadas encontradas. Buscando desde ${startDate.toISOString().split('T')[0]} hasta hoy`);
          } else {
            // Si no hay facturas, usar últimos 12 meses
            startDate = new Date();
            startDate.setMonth(startDate.getMonth() - 12);
            console.log(`[Sync] 📅 No hay facturas cacheadas. Buscando últimos 12 meses (desde ${startDate.toISOString().split('T')[0]})`);
          }
        }
        
        const dateFormat = (date: Date) => {
          const day = String(date.getDate()).padStart(2, '0');
          const month = String(date.getMonth() + 1).padStart(2, '0');
          const year = date.getFullYear();
          return `${day}/${month}/${year}`;
        };
        
        console.log(`[Sync] 🔍 Rango de fechas: ${dateFormat(startDate)} - ${dateFormat(endDate)}`);
        
        const automationResult = await callAfipSdkAutomation('mis-comprobantes', accessToken, {
          cuit: account.cuit,
          username: afipUsername,
          password: afipPassword,
          filters: {
            t: 'E', // Emitidos
            fechaEmision: `${dateFormat(startDate)} - ${dateFormat(endDate)}`
          }
        });
        
        if (automationResult && Array.isArray(automationResult)) {
          newInvoices = automationResult.map((comp: any) => {
            const amountStr = comp['Imp. Total'] || comp.importeTotal || comp.total || '0';
            const amount = parseFloat(amountStr.replace(/\./g, '').replace(',', '.')) || 0;
            
            const fechaEmision = comp['Fecha de Emisión'] || comp.fechaEmision || comp.fecha;
            const date = fechaEmision ? new Date(fechaEmision).toISOString() : new Date().toISOString();
            
            const tipo = comp['Tipo de Comprobante'] || comp.tipoComprobante || '';
            const puntoVenta = comp['Punto de Venta'] || comp.puntoVenta || '';
            const numeroDesde = comp['Número Desde'] || comp.numeroDesde || '';
            
            return {
              id: `${tipo}-${puntoVenta}-${numeroDesde}`,
              number: `${tipo}-${puntoVenta}-${numeroDesde}`,
              amount: amount,
              date: date,
              description: comp['Denominación Receptor'] || comp.denominacionReceptor || comp.concepto || comp.descripcion || '',
              status: 'authorized',
              cae: comp['Cód. Autorización'] || comp.cae || null,
              receptor: comp['Denominación Receptor'] || comp.denominacionReceptor || null,
              tipo: tipo,
              cuit: comp['CUIT'] || comp.cuit || account.cuit || null
            };
          });
          
          console.log(`[Sync] ✅ Automatización completada. ${newInvoices.length} facturas encontradas`);
        } else {
          console.log(`[Sync] ⚠️ La automatización no devolvió un array de comprobantes`);
        }
      } catch (error: any) {
        console.error(`[Sync] ❌ Error al sincronizar con automatización:`, error.message);
        return new Response(JSON.stringify({ 
          error: `Error al sincronizar con automatización: ${error.message}` 
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }
    
    // Guardar nuevas facturas en cache
    for (const invoice of newInvoices) {
      const existing = await env.DB.prepare(`
        SELECT id FROM invoices 
        WHERE arca_account_id = ? AND arca_invoice_id = ?
        LIMIT 1
      `).bind(accountId, invoice.id).first<{ id: string }>();
      
      if (existing) {
        await env.DB.prepare(`
          UPDATE invoices 
          SET amount = ?, date = ?, description = ?, cached_data = ?, updated_at = ?
          WHERE id = ?
        `).bind(
          invoice.amount,
          Math.floor(new Date(invoice.date).getTime() / 1000),
          invoice.description,
          JSON.stringify(invoice),
          Math.floor(Date.now() / 1000),
          existing.id
        ).run();
      } else {
        await env.DB.prepare(`
          INSERT INTO invoices 
          (id, arca_account_id, arca_invoice_id, amount, date, description, cached_data, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          generateId(),
          accountId,
          invoice.id,
          invoice.amount,
          Math.floor(new Date(invoice.date).getTime() / 1000),
          invoice.description,
          JSON.stringify(invoice),
          Math.floor(Date.now() / 1000),
          Math.floor(Date.now() / 1000)
        ).run();
      }
    }
    
    return new Response(JSON.stringify({ 
      success: true,
      message: `Se sincronizaron ${newInvoices.length} facturas nuevas`,
      count: newInvoices.length
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ 
      error: error.message || 'Error al sincronizar facturas' 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

function generateId(): string {
  return crypto.randomUUID();
}

