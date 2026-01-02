import { Env, BillingLimit, ArcaAccount } from '../utils/db';
import { getAuthUser } from './auth';

// Límites de facturación por categoría de monotributo
// Valores oficiales vigentes desde el 1/08/2025 según AFIP
// Fuente: https://www.afip.gob.ar/monotributo/categorias.asp
export const MONOTRIBUTO_LIMITS: Record<string, number> = {
  'A': 8_992_597.87,      // $ 8.992.597,87
  'B': 13_175_201.52,     // $ 13.175.201,52
  'C': 18_473_166.15,     // $ 18.473.166,15
  'D': 22_934_610.05,     // $ 22.934.610,05
  'E': 26_977_793.60,     // $ 26.977.793,60
  'F': 33_809_379.57,     // $ 33.809.379,57
  'G': 40_431_835.35,     // $ 40.431.835,35
  'H': 61_344_853.64,     // $ 61.344.853,64
  'I': 68_664_410.05,     // $ 68.664.410,05
  'J': 78_632_948.76,     // $ 78.632.948,76
  'K': 94_805_682.90      // $ 94.805.682,90
};

export async function getLimits(env: Env, accountId: string, userId: string): Promise<Response> {
  try {
    // Verificar que la cuenta pertenece al usuario
    const account = await env.DB.prepare(
      'SELECT * FROM arca_accounts WHERE id = ? AND user_id = ?'
    ).bind(accountId, userId).first();
    
    if (!account) {
      return new Response(JSON.stringify({ error: 'Cuenta ARCA no encontrada' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Obtener límite configurado o crear uno por defecto
    let limit = await env.DB.prepare(
      'SELECT * FROM billing_limits WHERE arca_account_id = ?'
    ).bind(accountId).first<BillingLimit>();
    
    if (!limit) {
      // Crear límite por defecto (categoría H - máximo)
      const defaultCategory = 'H';
      const defaultLimitAmount = MONOTRIBUTO_LIMITS[defaultCategory];
      
      await env.DB.prepare(`
        INSERT INTO billing_limits 
        (arca_account_id, category, limit_amount, alert_threshold)
        VALUES (?, ?, ?, ?)
      `).bind(accountId, defaultCategory, defaultLimitAmount, 0.8).run();
      
      limit = {
        arca_account_id: accountId,
        category: defaultCategory,
        limit_amount: defaultLimitAmount,
        alert_threshold: 0.8
      };
    }
    
    // Calcular total facturado en últimos 12 meses (365 días exactos)
    // Considerando que notas de crédito restan y notas de débito suman
    const now = new Date();
    const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 12, now.getDate());
    const twelveMonthsAgoTimestamp = Math.floor(twelveMonthsAgo.getTime() / 1000);
    
    // Obtener todas las facturas con su tipo para calcular correctamente
    const invoices = await env.DB.prepare(`
      SELECT amount, cached_data FROM invoices 
      WHERE arca_account_id = ? AND date >= ?
    `).bind(accountId, twelveMonthsAgoTimestamp).all<{ amount: number; cached_data: string | null }>();
    
    // Importar función para calcular monto ajustado
    const { calcularMontoAjustado } = await import('../utils/comprobantes');
    
    // Calcular total considerando tipo de comprobante
    let totalBilled = 0;
    for (const invoice of invoices.results) {
      let tipoComprobante: string | null = null;
      
      // Intentar obtener tipo desde cached_data
      if (invoice.cached_data) {
        try {
          const cached = JSON.parse(invoice.cached_data);
          tipoComprobante = cached.tipo || null;
        } catch (e) {
          // Si no se puede parsear, continuar
        }
      }
      
      // Calcular monto ajustado (notas de crédito restan, débito y facturas suman)
      totalBilled += calcularMontoAjustado(invoice.amount, tipoComprobante);
    }
    
    // Asegurar que el total no sea negativo
    totalBilled = Math.max(0, totalBilled);
    const limitAmount = limit.limit_amount;
    const percentage = (totalBilled / limitAmount) * 100;
    const remaining = limitAmount - totalBilled;
    
    // Determinar nivel de alerta
    let alertLevel: 'none' | 'warning' | 'danger' | 'exceeded' = 'none';
    if (percentage >= 100) {
      alertLevel = 'exceeded';
    } else if (percentage >= 90) {
      alertLevel = 'danger';
    } else if (percentage >= limit.alert_threshold * 100) {
      alertLevel = 'warning';
    }
    
    return new Response(JSON.stringify({
      category: limit.category,
      limit_amount: limitAmount,
      total_billed: totalBilled,
      remaining: remaining,
      percentage: Math.round(percentage * 100) / 100,
      alert_level: alertLevel,
      alert_threshold: limit.alert_threshold,
      next_due_amount: limit.next_due_amount || null,
      next_due_date: limit.next_due_date || null,
      billing_update_date: limit.billing_update_date || null,
      billed_amount: limit.billed_amount || null
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message || 'Error al obtener límites' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function setLimit(
  env: Env,
  accountId: string,
  userId: string,
  category: string,
  alertThreshold?: number
): Promise<Response> {
  try {
    // Verificar que la cuenta pertenece al usuario
    const account = await env.DB.prepare(
      'SELECT * FROM arca_accounts WHERE id = ? AND user_id = ?'
    ).bind(accountId, userId).first();
    
    if (!account) {
      return new Response(JSON.stringify({ error: 'Cuenta ARCA no encontrada' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const categoryUpper = category.toUpperCase();
    const limitAmount = MONOTRIBUTO_LIMITS[categoryUpper];
    if (!limitAmount) {
      const validCategories = Object.keys(MONOTRIBUTO_LIMITS).join(', ');
      return new Response(JSON.stringify({ 
        error: `Categoría inválida. Categorías válidas: ${validCategories}` 
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    await env.DB.prepare(`
      INSERT OR REPLACE INTO billing_limits 
      (arca_account_id, category, limit_amount, alert_threshold)
      VALUES (?, ?, ?, ?)
    `).bind(
      accountId,
      category.toUpperCase(),
      limitAmount,
      alertThreshold || 0.8
    ).run();
    
    return new Response(JSON.stringify({ 
      success: true,
      category: category.toUpperCase(),
      limit_amount: limitAmount,
      alert_threshold: alertThreshold || 0.8
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message || 'Error al configurar límite' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function syncMonotributoInfo(env: Env, accountId: string, userId: string): Promise<Response> {
  try {
    // Verificar que la cuenta pertenece al usuario
    const account = await env.DB.prepare(
      'SELECT * FROM arca_accounts WHERE id = ? AND user_id = ?'
    ).bind(accountId, userId).first<ArcaAccount>();
    
    if (!account) {
      return new Response(JSON.stringify({ error: 'Cuenta ARCA no encontrada' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    if (account.provider !== 'afip_sdk') {
      return new Response(JSON.stringify({ error: 'Esta funcionalidad solo está disponible para AFIP SDK' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    if (!account.cuit || !account.afip_username_encrypted || !account.afip_password_encrypted) {
      return new Response(JSON.stringify({ error: 'Faltan credenciales de AFIP' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Importar funciones necesarias
    const { getDecryptedCredentials, callAfipSdkAutomation } = await import('./arca');
    const { decrypt } = await import('../utils/encryption');
    
    const { accessToken } = await getDecryptedCredentials(env, account);
    const afipUsername = await decrypt(account.afip_username_encrypted, env.ENCRYPTION_KEY);
    const afipPassword = await decrypt(account.afip_password_encrypted, env.ENCRYPTION_KEY);
    
    // Llamar a la automatización monotributo-info
    console.log(`[Monotributo] Sincronizando información de monotributo para CUIT ${account.cuit}...`);
    let automationResult: any;
    try {
      automationResult = await callAfipSdkAutomation('monotributo-info', accessToken, {
        cuit: account.cuit,
        username: afipUsername,
        password: afipPassword
      });
      console.log(`[Monotributo] ✅ Automatización completada`);
      console.log(`[Monotributo] 📦 Respuesta completa de automatización:`, JSON.stringify(automationResult, null, 2));
    } catch (autoError: any) {
      console.error(`[Monotributo] Error en automatización:`, autoError);
      throw new Error(`Error al ejecutar automatización: ${autoError.message}`);
    }
    
    // La función callAfipSdkAutomation puede devolver directamente los datos o un objeto con data
    let monotributoData: any;
    if (automationResult.data) {
      monotributoData = automationResult.data;
    } else if (automationResult.category || automationResult.next_due_amount) {
      // Si los datos están directamente en el resultado
      monotributoData = automationResult;
    } else {
      console.error(`[Monotributo] Estructura de respuesta inesperada:`, JSON.stringify(automationResult, null, 2));
      return new Response(JSON.stringify({ 
        error: 'No se pudo obtener información de monotributo',
        details: 'La respuesta de la automatización no tiene la estructura esperada'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    console.log(`[Monotributo] 📊 Datos extraídos de monotributo:`);
    console.log(`  - Categoría: ${monotributoData.category || 'N/A'}`);
    console.log(`  - Monto facturado: ${monotributoData.billed_amount || 'N/A'}`);
    console.log(`  - Fecha actualización: ${monotributoData.billing_update_date || 'N/A'}`);
    console.log(`  - Próximo vencimiento: ${monotributoData.next_due_date || 'N/A'}`);
    console.log(`  - Monto a pagar: ${monotributoData.next_due_amount || 'N/A'}`);
    console.log(`[Monotributo] 📋 Datos completos (JSON):`, JSON.stringify(monotributoData, null, 2));
    
    // Validar que tenemos los datos necesarios
    if (!monotributoData || (!monotributoData.category && !monotributoData.next_due_amount)) {
      console.error(`[Monotributo] Datos incompletos:`, monotributoData);
      return new Response(JSON.stringify({ 
        error: 'La automatización no devolvió datos válidos',
        received: monotributoData
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Verificar si ya existe un límite con categoría configurada manualmente
    const existingLimit = await env.DB.prepare(
      'SELECT category, limit_amount, alert_threshold FROM billing_limits WHERE arca_account_id = ?'
    ).bind(accountId).first<{ category: string | null; limit_amount: number | null; alert_threshold: number | null }>();
    
    // Si ya existe una categoría configurada, mantenerla (no sobrescribir con la de AFIP)
    // Solo usar la categoría de AFIP si no hay una configurada manualmente
    let categoryToUse: string;
    let categoryLimit: number;
    let alertThreshold: number;
    
    if (existingLimit && existingLimit.category) {
      // Mantener la categoría existente (configurada manualmente)
      categoryToUse = existingLimit.category;
      categoryLimit = existingLimit.limit_amount || MONOTRIBUTO_LIMITS[categoryToUse] || MONOTRIBUTO_LIMITS['H'];
      alertThreshold = existingLimit.alert_threshold || 0.8;
      console.log(`[Monotributo] Manteniendo categoría manual existente: ${categoryToUse}`);
    } else {
      // No hay categoría configurada, usar la de AFIP o H por defecto
      categoryToUse = monotributoData.category || 'H';
      categoryLimit = MONOTRIBUTO_LIMITS[categoryToUse] || MONOTRIBUTO_LIMITS['H'];
      alertThreshold = 0.8;
      console.log(`[Monotributo] Usando categoría de AFIP o por defecto: ${categoryToUse}`);
    }
    
    console.log(`[Monotributo] Guardando datos: categoría=${categoryToUse}, próximo_pago=${monotributoData.next_due_amount}`);
    
    // Actualizar o crear el límite con la información de monotributo
    // Mantener la categoría manual si existe, pero actualizar otros campos
    try {
      await env.DB.prepare(`
        INSERT OR REPLACE INTO billing_limits 
        (arca_account_id, category, limit_amount, alert_threshold, next_due_amount, next_due_date, billing_update_date, billed_amount)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        accountId,
        categoryToUse,
        categoryLimit,
        alertThreshold,
        monotributoData.next_due_amount || null,
        monotributoData.next_due_date || null,
        monotributoData.billing_update_date || null,
        monotributoData.billed_amount || null
      ).run();
      console.log(`[Monotributo] ✅ Datos guardados en base de datos`);
    } catch (dbError: any) {
      console.error(`[Monotributo] Error al guardar en BD:`, dbError);
      throw new Error(`Error al guardar datos en base de datos: ${dbError.message}`);
    }
    
    console.log(`[Monotributo] ✅ Información sincronizada: Categoría ${categoryToUse}, Próximo pago: $${monotributoData.next_due_amount}`);
    
    return new Response(JSON.stringify({
      success: true,
      category: categoryToUse,
      next_due_amount: monotributoData.next_due_amount,
      next_due_date: monotributoData.next_due_date,
      billing_update_date: monotributoData.billing_update_date,
      billed_amount: monotributoData.billed_amount,
      category_preserved: existingLimit && existingLimit.category ? true : false
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    console.error(`[Monotributo] ❌ Error completo:`, error);
    console.error(`[Monotributo] ❌ Stack trace:`, error.stack);
    return new Response(JSON.stringify({ 
      error: error.message || 'Error al sincronizar información de monotributo',
      details: error.stack || error.toString()
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function handleLimits(request: Request, env: Env): Promise<Response> {
  const userId = await getAuthUser(request, env);
  if (!userId) {
    return new Response(JSON.stringify({ error: 'No autorizado' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  const url = new URL(request.url);
  const accountId = url.searchParams.get('account_id');
  
  if (!accountId) {
    return new Response(JSON.stringify({ error: 'account_id requerido' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  // POST /api/limits/sync - Sincronizar información de monotributo
  const pathParts = url.pathname.split('/').filter(p => p);
  if (request.method === 'POST' && pathParts.length === 3 && pathParts[2] === 'sync') {
    return syncMonotributoInfo(env, accountId, userId);
  }
  
  if (request.method === 'GET') {
    return getLimits(env, accountId, userId);
  }
  
  if (request.method === 'POST') {
    const body = await request.json() as { category: string; alert_threshold?: number };
    if (!body.category) {
      return new Response(JSON.stringify({ error: 'category requerido' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return setLimit(env, accountId, userId, body.category, body.alert_threshold);
  }
  
  return new Response(JSON.stringify({ error: 'Método no permitido' }), {
    status: 405,
    headers: { 'Content-Type': 'application/json' }
  });
}

