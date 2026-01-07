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
    
    // Obtener categoría actual desde el historial (sistema nuevo por semestres)
    // Si no hay historial, usa la más baja (A)
    const lastCategoryHistory = await env.DB.prepare(`
      SELECT category FROM category_history 
      WHERE arca_account_id = ? 
      ORDER BY period DESC 
      LIMIT 1
    `).bind(accountId).first<{ category: string }>();
    
    const currentCategory = lastCategoryHistory?.category || 'A';
    
    // Obtener límites vigentes actuales (del período actual)
    const now = new Date();
    const { getLimitsForDate } = await import('./recategorization');
    const currentLimits = await getLimitsForDate(env, now);
    const limitAmount = currentLimits[currentCategory] || MONOTRIBUTO_LIMITS[currentCategory] || 0;
    
    // Mantener alert_threshold del sistema antiguo si existe, sino usar default
    const oldLimit = await env.DB.prepare(
      'SELECT alert_threshold FROM billing_limits WHERE arca_account_id = ?'
    ).bind(accountId).first<{ alert_threshold: number }>();
    
    const alertThreshold = oldLimit?.alert_threshold || 0.8;
    
    // Calcular total facturado en últimos 12 meses (365 días exactos)
    // Considerando que notas de crédito restan y notas de débito suman
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
    const percentage = (totalBilled / limitAmount) * 100;
    const remaining = limitAmount - totalBilled;
    
    // Determinar nivel de alerta
    let alertLevel: 'none' | 'warning' | 'danger' | 'exceeded' = 'none';
    if (percentage >= 100) {
      alertLevel = 'exceeded';
    } else if (percentage >= 90) {
      alertLevel = 'danger';
    } else if (percentage >= alertThreshold * 100) {
      alertLevel = 'warning';
    }
    
    return new Response(JSON.stringify({
      category: currentCategory, // Usar categoría del historial (sistema nuevo)
      limit_amount: limitAmount, // Usar límite vigente actual
      total_billed: totalBilled,
      remaining: remaining,
      percentage: Math.round(percentage * 100) / 100,
      alert_level: alertLevel,
      alert_threshold: alertThreshold,
      next_due_amount: null, // Ya no se usa
      next_due_date: null, // Ya no se usa
      billing_update_date: null, // Ya no se usa
      billed_amount: null // Ya no se usa
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

// Determinar la categoría correspondiente a un monto total
function getCategoryForAmount(amount: number): string {
  const categories = Object.entries(MONOTRIBUTO_LIMITS).sort((a, b) => a[1] - b[1]);
  for (const [category, limit] of categories) {
    if (amount <= limit) {
      return category;
    }
  }
  return 'EXCEDIDO'; // Se pasó de todas las categorías
}

// Determinar la categoría usando límites históricos personalizados
function getCategoryForAmountWithLimits(amount: number, limits: Record<string, number>): string {
  const categories = Object.entries(limits).sort((a, b) => a[1] - b[1]);
  for (const [category, limit] of categories) {
    if (amount <= limit) {
      return category;
    }
  }
  return 'EXCEDIDO';
}

// Obtener la siguiente categoría
function getNextCategory(currentCategory: string): string | null {
  const categories = Object.keys(MONOTRIBUTO_LIMITS);
  const currentIndex = categories.indexOf(currentCategory);
  if (currentIndex === -1 || currentIndex === categories.length - 1) {
    return null;
  }
  return categories[currentIndex + 1];
}

export async function simulateScenarios(env: Env, accountId: string, userId: string): Promise<Response> {
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
    
    // Obtener categoría actual desde el historial (la más reciente)
    // Si no hay historial, usa la más baja (A)
    const lastCategoryHistory = await env.DB.prepare(`
      SELECT category FROM category_history 
      WHERE arca_account_id = ? 
      ORDER BY period DESC 
      LIMIT 1
    `).bind(accountId).first<{ category: string }>();
    
    const currentCategory = lastCategoryHistory?.category || 'A';
    
    // Obtener límites históricos para el período actual
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonthNum = now.getMonth(); // 0-indexed
    
    // Determinar qué período de límites usar
    // Si estamos en Enero-Junio, usar límites de Enero
    // Si estamos en Julio-Diciembre, usar límites de Julio
    let limitsPeriod: string;
    if (currentMonthNum < 6) {
      // Enero-Junio: usar límites de Enero del año actual
      limitsPeriod = `${currentYear}-01`;
    } else {
      // Julio-Diciembre: usar límites de Julio del año actual
      limitsPeriod = `${currentYear}-07`;
    }
    
    // Obtener límites históricos
    const limitsHistory = await env.DB.prepare(`
      SELECT limits_json FROM monotributo_limits_history 
      WHERE period = ?
      ORDER BY period DESC
      LIMIT 1
    `).bind(limitsPeriod).first<{ limits_json: string }>();
    
    // Parsear límites históricos o usar los por defecto
    let limits: Record<string, number>;
    if (limitsHistory?.limits_json) {
      try {
        limits = JSON.parse(limitsHistory.limits_json);
      } catch (e) {
        limits = MONOTRIBUTO_LIMITS;
      }
    } else {
      limits = MONOTRIBUTO_LIMITS;
    }
    
    const currentLimit = limits[currentCategory] || limits['A'];
    
    // Calcular cuántos meses simular según la próxima recategorización
    // Importar función de recategorización
    const { getRecategorizationPeriods } = await import('./recategorization');
    const periods = getRecategorizationPeriods(now);
    
    // Filtrar solo períodos futuros (que aún no hayan pasado)
    const nowTime = now.getTime();
    const futurePeriods = periods.filter(p => p.deadline.getTime() > nowTime);
    
    // Si estamos en el mes de recategorización (enero o julio), tomar el SIGUIENTE período futuro
    // Si no estamos en el mes de recategorización, tomar el primero futuro
    let nextRecategorization;
    if (futurePeriods.length > 0) {
      // Si el primer período futuro es del mes actual y aún no pasó el deadline,
      // tomar el segundo período futuro (el siguiente)
      const firstFuture = futurePeriods[0];
      const isCurrentRecatMonth = (now.getMonth() === 0 && firstFuture.id === 'january') || 
                                   (now.getMonth() === 6 && firstFuture.id === 'july');
      
      if (isCurrentRecatMonth && futurePeriods.length > 1) {
        // Estamos en el mes de recategorización, tomar el siguiente
        nextRecategorization = futurePeriods[1];
      } else {
        // No estamos en el mes de recategorización, tomar el primero futuro
        nextRecategorization = futurePeriods[0];
      }
    } else {
      // No hay períodos futuros, usar el último período
      nextRecategorization = periods[periods.length - 1];
    }
    
    console.log(`[Simulador] Períodos disponibles:`, periods.map(p => ({ name: p.name, deadline: p.deadline.toISOString(), daysRemaining: p.daysRemaining })));
    console.log(`[Simulador] Períodos futuros:`, futurePeriods.map(p => ({ name: p.name, deadline: p.deadline.toISOString() })));
    console.log(`[Simulador] Próxima recategorización seleccionada:`, nextRecategorization.name);
    
    // Calcular meses hasta la próxima recategorización
    const nextRecatDate = nextRecategorization.deadline;
    
    // Calcular meses completos hasta la recategorización
    // Si estamos en Enero y la próxima es Julio, son 6 meses (Ene, Feb, Mar, Abr, May, Jun)
    // Si estamos en Mayo y la próxima es Julio, son 2 meses (May, Jun)
    // Si estamos en Junio y la próxima es Julio, es 1 mes (Jun)
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextRecatMonthStart = new Date(nextRecatDate.getFullYear(), nextRecatDate.getMonth(), 1);
    
    let monthsToSimulate = 0;
    let checkMonth = new Date(currentMonthStart);
    
    // Contar meses completos desde el mes actual hasta el mes de recategorización (excluyendo el mes de recategorización)
    // Si estamos en Enero (mes 0) y la próxima es Julio (mes 6), contamos: Ene(0), Feb(1), Mar(2), Abr(3), May(4), Jun(5) = 6 meses
    while (checkMonth < nextRecatMonthStart) {
      monthsToSimulate++;
      checkMonth = new Date(checkMonth.getFullYear(), checkMonth.getMonth() + 1, 1);
    }
    
    // Asegurar mínimo 1 mes y máximo 6 meses
    monthsToSimulate = Math.max(1, Math.min(monthsToSimulate, 6));
    
    console.log(`[Simulador] Cálculo de meses: actual=${now.getMonth() + 1}/${now.getFullYear()}, próxima recat=${nextRecatDate.getMonth() + 1}/${nextRecatDate.getFullYear()}, meses a simular=${monthsToSimulate}`);
    console.log(`[Simulador] currentMonthStart=${currentMonthStart.toISOString()}, nextRecatMonthStart=${nextRecatMonthStart.toISOString()}`);
    
    // Obtener facturas de los últimos 13 meses (necesitamos 13 para saber qué "sale" cada mes)
    const thirteenMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 13, 1);
    const thirteenMonthsAgoTimestamp = Math.floor(thirteenMonthsAgo.getTime() / 1000);
    
    const invoices = await env.DB.prepare(`
      SELECT amount, date, cached_data FROM invoices 
      WHERE arca_account_id = ? AND date >= ?
      ORDER BY date ASC
    `).bind(accountId, thirteenMonthsAgoTimestamp).all<{ amount: number; date: number; cached_data: string | null }>();
    
    const { calcularMontoAjustado } = await import('../utils/comprobantes');
    
    // Agrupar facturas por mes con montos ajustados
    const monthlyData: Record<string, number> = {};
    
    // Inicializar últimos 13 meses con 0
    for (let i = 13; i >= 0; i--) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      monthlyData[key] = 0;
    }
    
    // Sumar facturas por mes
    for (const invoice of invoices.results) {
      const date = new Date(invoice.date * 1000);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      
      let tipoComprobante: string | null = null;
      if (invoice.cached_data) {
        try {
          const cached = JSON.parse(invoice.cached_data);
          tipoComprobante = cached.tipo || null;
        } catch (e) {}
      }
      
      if (monthlyData[key] !== undefined) {
        monthlyData[key] += calcularMontoAjustado(invoice.amount, tipoComprobante);
      }
    }
    
    // Convertir a array ordenado por fecha
    const monthsArray = Object.entries(monthlyData)
      .map(([month, amount]) => ({ month, amount: Math.max(0, amount) }))
      .sort((a, b) => a.month.localeCompare(b.month));
    
    // Calcular total de últimos 12 meses (excluyendo el más antiguo)
    const last12Months = monthsArray.slice(-12);
    const totalBilled = last12Months.reduce((sum, m) => sum + m.amount, 0);
    
    // Calcular promedio mensual (evitar división por 0)
    const monthsWithData = last12Months.filter(m => m.amount > 0).length;
    const monthlyAverage = monthsWithData > 0 ? totalBilled / monthsWithData : 0;
    
    // Obtener los 3 meses que "saldrán" de la ventana cuando proyectemos
    const exitingMonths = monthsArray.slice(-15, -12); // Los 3 meses más viejos dentro de la ventana actual
    
    // Generar proyecciones
    const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    
    function generateProjections(monthlyAmount: number, scenarioName: string) {
      const projections = [];
      let runningTotal = totalBilled;
      
      console.log(`[generateProjections ${scenarioName}] Generando ${monthsToSimulate} proyecciones desde ${currentMonth.toISOString()}`);
      
      // Simular desde el mes actual hasta la próxima recategorización
      for (let i = 0; i < monthsToSimulate; i++) {
        const projectionDate = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + i, 1);
        const projectionKey = `${projectionDate.getFullYear()}-${String(projectionDate.getMonth() + 1).padStart(2, '0')}`;
        console.log(`[generateProjections ${scenarioName}] Mes ${i + 1}/${monthsToSimulate}: ${projectionKey}`);
        
        // El mes que "sale" de la ventana es el de hace 12 meses desde la proyección
        const exitingDate = new Date(projectionDate.getFullYear(), projectionDate.getMonth() - 12, 1);
        const exitingKey = `${exitingDate.getFullYear()}-${String(exitingDate.getMonth() + 1).padStart(2, '0')}`;
        const exitingAmount = monthlyData[exitingKey] || 0;
        
        // Nuevo total = total anterior - lo que sale + lo nuevo
        runningTotal = runningTotal - exitingAmount + monthlyAmount;
        
        // Usar límites históricos para determinar categoría
        const projectedCategory = getCategoryForAmountWithLimits(runningTotal, limits);
        const exceedsCurrentCategory = runningTotal > currentLimit;
        const maxLimit = Math.max(...Object.values(limits));
        const exceedsAllCategories = runningTotal > maxLimit;
        
        let status: 'ok' | 'warning' | 'exceeded' = 'ok';
        if (exceedsAllCategories) {
          status = 'exceeded';
        } else if (exceedsCurrentCategory) {
          status = 'warning';
        }
        
        projections.push({
          month: projectionKey,
          exiting_month: exitingKey,
          exiting_amount: Math.round(exitingAmount),
          new_amount: Math.round(monthlyAmount),
          total: Math.round(runningTotal),
          category: projectedCategory,
          category_limit: limits[projectedCategory] || 0,
          status,
          exceeds_current: exceedsCurrentCategory
        });
      }
      
      return projections;
    }
    
    // Calcular máximo facturable por mes sin cambiar de categoría
    function calculateMaximum() {
      const projections = [];
      let runningTotal = totalBilled;
      
      // Simular desde el mes actual hasta la próxima recategorización
      for (let i = 0; i < monthsToSimulate; i++) {
        const projectionDate = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + i, 1);
        const projectionKey = `${projectionDate.getFullYear()}-${String(projectionDate.getMonth() + 1).padStart(2, '0')}`;
        
        const exitingDate = new Date(projectionDate.getFullYear(), projectionDate.getMonth() - 12, 1);
        const exitingKey = `${exitingDate.getFullYear()}-${String(exitingDate.getMonth() + 1).padStart(2, '0')}`;
        const exitingAmount = monthlyData[exitingKey] || 0;
        
        // Máximo que puedo facturar = límite - (total actual - lo que sale)
        const baseAfterExiting = runningTotal - exitingAmount;
        const maxFacturable = Math.max(0, currentLimit - baseAfterExiting);
        
        // Actualizar running total asumiendo que facturo el máximo
        runningTotal = baseAfterExiting + maxFacturable;
        
        projections.push({
          month: projectionKey,
          exiting_month: exitingKey,
          exiting_amount: Math.round(exitingAmount),
          max_facturable: Math.round(maxFacturable),
          total_if_max: Math.round(runningTotal),
          category: currentCategory,
          status: 'ok' as const
        });
      }
      
      return projections;
    }
    
    // Generar escenarios
    const conservativeAmount = monthlyAverage * 0.5;
    const normalAmount = monthlyAverage;
    const aggressiveAmount = monthlyAverage * 1.5;
    
    console.log(`[Simulador] Meses a simular: ${monthsToSimulate}, Próxima recategorización: ${nextRecategorization.name}`);
    
    const response = {
      current: {
        category: currentCategory,
        limit: currentLimit,
        total_billed: Math.round(totalBilled),
        remaining: Math.round(currentLimit - totalBilled),
        percentage: Math.round((totalBilled / currentLimit) * 10000) / 100,
        monthly_average: Math.round(monthlyAverage),
        next_category: getNextCategory(currentCategory),
        next_category_limit: getNextCategory(currentCategory) ? limits[getNextCategory(currentCategory)!] : null,
        months_to_recategorization: monthsToSimulate,
        next_recategorization: nextRecategorization.name
      },
      months_data: last12Months,
      all_categories: limits,
      scenarios: {
        conservative: {
          name: 'Conservador',
          description: '50% del promedio mensual',
          monthly_amount: Math.round(conservativeAmount),
          projections: generateProjections(conservativeAmount, 'conservative')
        },
        normal: {
          name: 'Normal',
          description: 'Mantener promedio actual',
          monthly_amount: Math.round(normalAmount),
          projections: generateProjections(normalAmount, 'normal')
        },
        aggressive: {
          name: 'Agresivo',
          description: '150% del promedio mensual',
          monthly_amount: Math.round(aggressiveAmount),
          projections: generateProjections(aggressiveAmount, 'aggressive')
        },
        maximum: {
          name: 'Máximo sin recategorización',
          description: `Máximo para mantenerse en categoría ${currentCategory}`,
          projections: calculateMaximum()
        }
      }
    };
    
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    console.error('[Simulador] Error:', error);
    return new Response(JSON.stringify({ error: error.message || 'Error al simular escenarios' }), {
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
  
  // GET/POST /api/limits/simulate - Simular escenarios
  const pathParts = url.pathname.split('/').filter(p => p);
  if (pathParts.length === 3 && pathParts[2] === 'simulate') {
    return simulateScenarios(env, accountId, userId);
  }
  
  // POST /api/limits/sync - Sincronizar información de monotributo
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

