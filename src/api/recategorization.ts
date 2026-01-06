import { Env } from '../utils/db';
import { getAuthUser } from './auth';
import { MONOTRIBUTO_LIMITS } from './limits';

// Determinar la categoría correspondiente a un monto total
function getCategoryForAmount(amount: number, limits?: Record<string, number>): string {
  const limitsToUse = limits || MONOTRIBUTO_LIMITS;
  const categories = Object.entries(limitsToUse).sort((a, b) => a[1] - b[1]);
  for (const [category, limit] of categories) {
    if (amount <= limit) {
      return category;
    }
  }
  return 'EXCEDIDO';
}

// Obtener información de una categoría
function getCategoryInfo(category: string, limits?: Record<string, number>) {
  const limitsToUse = limits || MONOTRIBUTO_LIMITS;
  const categories = Object.keys(limitsToUse);
  const index = categories.indexOf(category);
  return {
    category,
    limit: limitsToUse[category] || 0,
    index,
    nextCategory: index < categories.length - 1 ? categories[index + 1] : null,
    prevCategory: index > 0 ? categories[index - 1] : null,
    nextLimit: index < categories.length - 1 ? limitsToUse[categories[index + 1]] : null,
    prevLimit: index > 0 ? limitsToUse[categories[index - 1]] : null
  };
}

// Calcular los períodos de recategorización
export function getRecategorizationPeriods(now: Date) {
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth(); // 0-indexed (0 = Enero, 6 = Julio)
  const currentDay = now.getDate();
  
  // Período de Enero: evalúa Ene-Dic del año anterior
  // Período de Julio: evalúa Jul del año anterior a Jun del mismo año
  // La recategorización se hace hasta el día 20 del mes correspondiente
  
  const periods = [];
  
  // Determinar próxima recategorización de Enero
  // Si estamos en Enero y antes del día 20, es este Enero
  // Si estamos después de Enero 20, es el próximo Enero
  let nextJanuaryYear: number;
  if (currentMonth === 0 && currentDay <= 20) {
    // Estamos en Enero antes del deadline
    nextJanuaryYear = currentYear;
  } else {
    // Ya pasó Enero 20, la próxima es el año que viene
    nextJanuaryYear = currentYear + 1;
  }
  const januaryDeadline = new Date(nextJanuaryYear, 0, 20); // 20 de enero
  
  // Determinar próxima recategorización de Julio
  // Si estamos antes de Julio 20, es este Julio
  // Si estamos después de Julio 20, es el próximo Julio
  let nextJulyYear: number;
  if (currentMonth < 6 || (currentMonth === 6 && currentDay <= 20)) {
    // Estamos antes de Julio 20
    nextJulyYear = currentYear;
  } else {
    // Ya pasó Julio 20, la próxima es el año que viene
    nextJulyYear = currentYear + 1;
  }
  const julyDeadline = new Date(nextJulyYear, 6, 20); // 20 de julio
  
  // Recategorización de Enero
  periods.push({
    id: 'january',
    name: `Enero ${nextJanuaryYear}`,
    deadline: januaryDeadline,
    periodStart: new Date(nextJanuaryYear - 1, 0, 1), // 1 Ene año anterior
    periodEnd: new Date(nextJanuaryYear - 1, 11, 31), // 31 Dic año anterior
    periodLabel: `Ene ${nextJanuaryYear - 1} → Dic ${nextJanuaryYear - 1}`,
    daysRemaining: Math.max(0, Math.ceil((januaryDeadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
  });
  
  // Recategorización de Julio
  periods.push({
    id: 'july',
    name: `Julio ${nextJulyYear}`,
    deadline: julyDeadline,
    periodStart: new Date(nextJulyYear - 1, 6, 1), // 1 Jul año anterior
    periodEnd: new Date(nextJulyYear, 5, 30), // 30 Jun mismo año
    periodLabel: `Jul ${nextJulyYear - 1} → Jun ${nextJulyYear}`,
    daysRemaining: Math.max(0, Math.ceil((julyDeadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
  });
  
  // Ordenar por fecha más cercana
  periods.sort((a, b) => a.deadline.getTime() - b.deadline.getTime());
  
  return periods;
}

// Generar timeline de recategorizaciones (pasadas y futuras)
function generateTimeline(now: Date, currentCategory: string) {
  const timeline: Array<{date: Date; type: string; label: string; status: string; category: string | null}> = [];
  const currentYear = now.getFullYear();
  const nowTime = now.getTime();
  
  // Generar todas las recategorizaciones desde 2 años atrás hasta 2 años adelante
  for (let year = currentYear - 1; year <= currentYear + 2; year++) {
    // Enero de cada año
    const januaryDate = new Date(year, 0, 20);
    timeline.push({
      date: januaryDate,
      type: 'january',
      label: `Ene ${year}`,
      status: januaryDate.getTime() <= nowTime ? 'past' : 'future',
      category: null
    });
    
    // Julio de cada año
    const julyDate = new Date(year, 6, 20);
    timeline.push({
      date: julyDate,
      type: 'july',
      label: `Jul ${year}`,
      status: julyDate.getTime() <= nowTime ? 'past' : 'future',
      category: null
    });
  }
  
  // Ordenar por fecha
  timeline.sort((a, b) => a.date.getTime() - b.date.getTime());
  
  // Marcar la próxima (primera que sea 'future')
  let foundNext = false;
  for (const item of timeline) {
    if (!foundNext && item.status === 'future') {
      item.status = 'next';
      foundNext = true;
      break;
    }
  }
  
  // Filtrar: mostrar 2-3 pasadas y las futuras cercanas
  const pastItems = timeline.filter(t => t.status === 'past').slice(-3);
  const futureItems = timeline.filter(t => t.status === 'next' || t.status === 'future').slice(0, 4);
  
  return [...pastItems, ...futureItems];
}

export async function getRecategorizationData(env: Env, accountId: string, userId: string): Promise<Response> {
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
    
    const now = new Date();
    const periods = getRecategorizationPeriods(now);
    
    // Obtener límites actuales para la categoría actual
    const currentLimits = await getLimitsForDate(env, now);
    const currentCategoryInfo = getCategoryInfo(currentCategory, currentLimits);
    
    // Importar función para calcular monto ajustado
    const { calcularMontoAjustado } = await import('../utils/comprobantes');
    
    // Calcular totales para cada período
    const periodResults = [];
    
    for (const period of periods) {
      const startTimestamp = Math.floor(period.periodStart.getTime() / 1000);
      const endTimestamp = Math.floor(period.periodEnd.getTime() / 1000);
      
      // Obtener límites vigentes para la fecha del deadline de recategorización
      const limitsForPeriod = await getLimitsForDate(env, period.deadline);
      
      // Obtener facturas del período
      const invoices = await env.DB.prepare(`
        SELECT amount, date, cached_data FROM invoices 
        WHERE arca_account_id = ? AND date >= ? AND date <= ?
        ORDER BY date ASC
      `).bind(accountId, startTimestamp, endTimestamp).all<{ amount: number; date: number; cached_data: string | null }>();
      
      // Calcular total del período
      let periodTotal = 0;
      const monthlyBreakdown: Record<string, number> = {};
      
      for (const invoice of invoices.results) {
        let tipoComprobante: string | null = null;
        if (invoice.cached_data) {
          try {
            const cached = JSON.parse(invoice.cached_data);
            tipoComprobante = cached.tipo || null;
          } catch (e) {}
        }
        
        const adjustedAmount = calcularMontoAjustado(invoice.amount, tipoComprobante);
        periodTotal += adjustedAmount;
        
        // Agrupar por mes
        const date = new Date(invoice.date * 1000);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        monthlyBreakdown[monthKey] = (monthlyBreakdown[monthKey] || 0) + adjustedAmount;
      }
      
      periodTotal = Math.max(0, periodTotal);
      
      // Calcular meses restantes en el período
      const periodEndDate = period.periodEnd;
      const monthsRemaining = Math.max(0, 
        (periodEndDate.getFullYear() - now.getFullYear()) * 12 + 
        (periodEndDate.getMonth() - now.getMonth())
      );
      
      // Calcular promedio mensual del período
      const monthsElapsed = Object.keys(monthlyBreakdown).length || 1;
      const monthlyAverage = periodTotal / monthsElapsed;
      
      // Proyectar total al final del período
      const projectedTotal = periodTotal + (monthlyAverage * monthsRemaining);
      
      // Determinar categoría proyectada usando los límites vigentes para ese período
      const projectedCategory = getCategoryForAmount(projectedTotal, limitsForPeriod);
      const projectedCategoryInfo = getCategoryInfo(projectedCategory, limitsForPeriod);
      
      // Calcular máximo facturable para mantenerse en categoría actual usando límites vigentes
      const currentLimit = limitsForPeriod[currentCategory] || 0;
      const remainingToLimit = Math.max(0, currentLimit - periodTotal);
      const maxMonthlyToStay = monthsRemaining > 0 ? remainingToLimit / monthsRemaining : 0;
      
      // Determinar si sube, baja o se mantiene
      // Comparar con la categoría actual usando los límites vigentes
      const currentCategoryInfo = getCategoryInfo(currentCategory, limitsForPeriod);
      let trend: 'up' | 'down' | 'same' = 'same';
      if (projectedCategoryInfo.index > currentCategoryInfo.index) {
        trend = 'up';
      } else if (projectedCategoryInfo.index < currentCategoryInfo.index) {
        trend = 'down';
      }
      
      periodResults.push({
        ...period,
        periodStart: period.periodStart.toISOString(),
        periodEnd: period.periodEnd.toISOString(),
        deadline: period.deadline.toISOString(),
        
        // Totales
        currentTotal: Math.round(periodTotal),
        projectedTotal: Math.round(projectedTotal),
        monthlyAverage: Math.round(monthlyAverage),
        
        // Categorías
        currentCategory,
        currentCategoryLimit: currentLimit,
        projectedCategory,
        projectedCategoryLimit: limitsForPeriod[projectedCategory] || 0,
        trend,
        
        // Para mantenerse
        remainingToLimit: Math.round(remainingToLimit),
        maxMonthlyToStay: Math.round(maxMonthlyToStay),
        monthsRemaining,
        
        // Porcentaje usado
        percentageUsed: currentLimit > 0 ? Math.round((periodTotal / currentLimit) * 10000) / 100 : 0,
        
        // Breakdown mensual
        monthlyBreakdown
      });
    }
    
    // Generar timeline
    const timeline = generateTimeline(now, currentCategory);
    
    // Determinar próxima recategorización
    const nextRecategorization = periodResults[0];
    
    const response = {
      currentCategory,
      currentCategoryInfo,
      allCategories: currentLimits, // Usar límites actuales en lugar de hardcodeados
      
      nextRecategorization,
      periods: periodResults,
      timeline,
      
      // Consejos
      advice: generateAdvice(nextRecategorization, currentCategoryInfo)
    };
    
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    console.error('[Recategorization] Error:', error);
    return new Response(JSON.stringify({ error: error.message || 'Error al obtener datos de recategorización' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

function generateAdvice(period: any, categoryInfo: any): string[] {
  const advice: string[] = [];
  
  if (period.trend === 'up') {
    advice.push(`⚠️ Con tu facturación actual, subirías a categoría ${period.projectedCategory} en ${period.name}`);
    if (period.maxMonthlyToStay > 0) {
      advice.push(`💡 Para mantenerte en ${period.currentCategory}, podés facturar máximo $${(period.maxMonthlyToStay / 1000000).toFixed(1)}M por mes`);
    }
  } else if (period.trend === 'down') {
    advice.push(`📉 Con tu facturación actual, bajarías a categoría ${period.projectedCategory}`);
    advice.push(`💰 Esto significa que pagarías menos de cuota mensual`);
  } else {
    advice.push(`✅ Con tu facturación actual, te mantendrías en categoría ${period.currentCategory}`);
    const remaining = period.remainingToLimit;
    if (remaining > 0) {
      advice.push(`📊 Todavía podés facturar $${(remaining / 1000000).toFixed(1)}M más sin cambiar de categoría`);
    }
  }
  
  return advice;
}

// =====================================================
// HISTORIAL DE CATEGORÍAS
// =====================================================

export async function getCategoryHistory(env: Env, accountId: string, userId: string): Promise<Response> {
  try {
    // Verificar que la cuenta pertenece al usuario
    const account = await env.DB.prepare(
      'SELECT id FROM arca_accounts WHERE id = ? AND user_id = ?'
    ).bind(accountId, userId).first();
    
    if (!account) {
      return new Response(JSON.stringify({ error: 'Cuenta no encontrada' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const history = await env.DB.prepare(`
      SELECT * FROM category_history 
      WHERE arca_account_id = ? 
      ORDER BY period DESC
    `).bind(accountId).all();
    
    return new Response(JSON.stringify({ history: history.results || [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function saveCategoryHistory(env: Env, accountId: string, userId: string, data: any): Promise<Response> {
  try {
    // Verificar que la cuenta pertenece al usuario
    const account = await env.DB.prepare(
      'SELECT id FROM arca_accounts WHERE id = ? AND user_id = ?'
    ).bind(accountId, userId).first();
    
    if (!account) {
      return new Response(JSON.stringify({ error: 'Cuenta no encontrada' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const { period, category, total_billed, notes } = data;
    
    if (!period || !category) {
      return new Response(JSON.stringify({ error: 'period y category son requeridos' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Validar formato del período (YYYY-MM donde MM es 01 o 07)
    if (!/^\d{4}-(01|07)$/.test(period)) {
      return new Response(JSON.stringify({ error: 'Formato de período inválido. Usar YYYY-01 o YYYY-07' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Validar categoría
    const validCategories = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'];
    if (!validCategories.includes(category.toUpperCase())) {
      return new Response(JSON.stringify({ error: 'Categoría inválida' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    
    // Upsert: insertar o actualizar si ya existe
    await env.DB.prepare(`
      INSERT INTO category_history (id, arca_account_id, period, category, total_billed, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(arca_account_id, period) DO UPDATE SET
        category = excluded.category,
        total_billed = excluded.total_billed,
        notes = excluded.notes,
        updated_at = excluded.updated_at
    `).bind(id, accountId, period, category.toUpperCase(), total_billed || null, notes || null, now, now).run();
    
    return new Response(JSON.stringify({ success: true, period, category: category.toUpperCase() }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// =====================================================
// HISTORIAL DE LÍMITES DEL MONOTRIBUTO
// =====================================================

export async function getLimitsHistory(env: Env, onlyLatest: boolean = false): Promise<Response> {
  try {
    let query = `
      SELECT * FROM monotributo_limits_history 
      ORDER BY valid_from DESC
    `;
    
    if (onlyLatest) {
      query += ' LIMIT 1';
    }
    
    const history = await env.DB.prepare(query).all();
    
    // Parsear el JSON de límites
    const results = (history.results || []).map((item: any) => ({
      ...item,
      limits: JSON.parse(item.limits_json || '{}')
    }));
    
    return new Response(JSON.stringify({ limits: results }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}


export async function saveLimitsHistory(env: Env, userId: string, data: any): Promise<Response> {
  try {
    // Verificar que el usuario sea admin
    const user = await env.DB.prepare(
      'SELECT is_admin FROM users WHERE id = ?'
    ).bind(userId).first<{ is_admin: number }>();
    
    if (!user || user.is_admin !== 1) {
      return new Response(JSON.stringify({ error: 'No tienes permisos para modificar límites' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const { period, valid_from, limits, source, notes } = data;
    
    if (!period || !valid_from || !limits) {
      return new Response(JSON.stringify({ error: 'period, valid_from y limits son requeridos' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Validar formato del período
    if (!/^\d{4}-(01|07)$/.test(period)) {
      return new Response(JSON.stringify({ error: 'Formato de período inválido. Usar YYYY-01 o YYYY-07' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Validar que limits tiene las categorías esperadas
    const requiredCategories = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'];
    for (const cat of requiredCategories) {
      if (typeof limits[cat] !== 'number') {
        return new Response(JSON.stringify({ error: `Límite para categoría ${cat} es requerido` }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }
    
    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const validFromTimestamp = typeof valid_from === 'number' ? valid_from : Math.floor(new Date(valid_from).getTime() / 1000);
    
    // Upsert
    await env.DB.prepare(`
      INSERT INTO monotributo_limits_history (id, period, valid_from, limits_json, source, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(period) DO UPDATE SET
        valid_from = excluded.valid_from,
        limits_json = excluded.limits_json,
        source = excluded.source,
        notes = excluded.notes
    `).bind(id, period, validFromTimestamp, JSON.stringify(limits), source || 'manual', notes || null, now).run();
    
    return new Response(JSON.stringify({ success: true, period }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Obtener los límites vigentes para una fecha específica
export async function getLimitsForDate(env: Env, date: Date): Promise<Record<string, number>> {
  try {
    const timestamp = Math.floor(date.getTime() / 1000);
    
    const result = await env.DB.prepare(`
      SELECT limits_json FROM monotributo_limits_history 
      WHERE valid_from <= ?
      ORDER BY valid_from DESC
      LIMIT 1
    `).bind(timestamp).first<{ limits_json: string }>();
    
    if (result) {
      return JSON.parse(result.limits_json);
    }
    
    // Si no hay historial, usar los límites actuales hardcodeados
    return MONOTRIBUTO_LIMITS;
  } catch (error) {
    console.error('[getLimitsForDate] Error:', error);
    return MONOTRIBUTO_LIMITS;
  }
}

// =====================================================
// SUGERENCIA DE CATEGORÍA PARA UN PERÍODO
// =====================================================

export async function calculatePeriodSuggestion(env: Env, accountId: string, userId: string, period: string): Promise<Response> {
  try {
    // Verificar que la cuenta pertenece al usuario
    const account = await env.DB.prepare(
      'SELECT id FROM arca_accounts WHERE id = ? AND user_id = ?'
    ).bind(accountId, userId).first();
    
    if (!account) {
      return new Response(JSON.stringify({ error: 'Cuenta no encontrada' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Validar formato del período
    if (!/^\d{4}-(01|07)$/.test(period)) {
      return new Response(JSON.stringify({ error: 'Formato de período inválido' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Calcular fechas del período
    const [yearStr, monthStr] = period.split('-');
    const year = parseInt(yearStr);
    const month = parseInt(monthStr);
    
    let startTimestamp: number;
    let endTimestamp: number;
    let periodLabel: string;
    
    if (month === 1) {
      // Enero: evalúa Ene-Dic del año anterior
      // Usar Date.UTC para evitar problemas de timezone
      startTimestamp = Math.floor(Date.UTC(year - 1, 0, 1, 0, 0, 0) / 1000);
      endTimestamp = Math.floor(Date.UTC(year - 1, 11, 31, 23, 59, 59) / 1000);
      periodLabel = `Ene ${year - 1} → Dic ${year - 1}`;
    } else {
      // Julio: evalúa Jul año anterior a Jun mismo año
      startTimestamp = Math.floor(Date.UTC(year - 1, 6, 1, 0, 0, 0) / 1000);
      endTimestamp = Math.floor(Date.UTC(year, 5, 30, 23, 59, 59) / 1000);
      periodLabel = `Jul ${year - 1} → Jun ${year}`;
    }
    
    console.log(`[Suggest] Período ${period}: timestamps ${startTimestamp} - ${endTimestamp}`);
    
    // Obtener facturas del período
    const { calcularMontoAjustado } = await import('../utils/comprobantes');
    
    const invoices = await env.DB.prepare(`
      SELECT amount, date, cached_data FROM invoices 
      WHERE arca_account_id = ? AND date >= ? AND date <= ?
      ORDER BY date ASC
    `).bind(accountId, startTimestamp, endTimestamp).all<{ amount: number; date: number; cached_data: string | null }>();
    
    console.log(`[Suggest] Encontradas ${invoices.results.length} facturas para el período`);
    
    // Calcular total del período
    let totalBilled = 0;
    const monthlyBreakdown: Record<string, number> = {};
    
    for (const invoice of invoices.results) {
      let tipoComprobante: string | null = null;
      if (invoice.cached_data) {
        try {
          const cached = JSON.parse(invoice.cached_data);
          tipoComprobante = cached.tipo || null;
        } catch (e) {}
      }
      
      const adjustedAmount = calcularMontoAjustado(invoice.amount, tipoComprobante);
      totalBilled += adjustedAmount;
      
      // Agrupar por mes
      const date = new Date(invoice.date * 1000);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      monthlyBreakdown[monthKey] = (monthlyBreakdown[monthKey] || 0) + adjustedAmount;
    }
    
    totalBilled = Math.max(0, Math.round(totalBilled));
    
    // Obtener los límites vigentes para ese período
    const periodEndDate = new Date(endTimestamp * 1000);
    const limits = await getLimitsForDate(env, periodEndDate);
    
    // Determinar categoría sugerida usando los límites vigentes para ese período
    const suggestedCategory = getCategoryForAmount(totalBilled, limits);
    
    return new Response(JSON.stringify({
      period,
      periodLabel,
      periodStart: new Date(startTimestamp * 1000).toISOString(),
      periodEnd: periodEndDate.toISOString(),
      totalBilled,
      suggestedCategory,
      categoryLimit: limits[suggestedCategory] || 0,
      invoiceCount: invoices.results.length,
      monthlyBreakdown,
      hasData: invoices.results.length > 0
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    console.error('[calculatePeriodSuggestion] Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// =====================================================
// ROUTER PRINCIPAL
// =====================================================

export async function handleRecategorization(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  
  // Rutas públicas (límites del monotributo)
  if (path === '/api/recategorization/limits') {
    if (request.method === 'GET') {
      // Si viene el parámetro only_latest=true, devolver solo el último
      const onlyLatest = url.searchParams.get('only_latest') === 'true';
      // Si viene el parámetro period, buscar ese período específico
      const specificPeriod = url.searchParams.get('period') || undefined;
      return getLimitsHistory(env, onlyLatest, specificPeriod);
    }
    if (request.method === 'POST') {
      const userId = await getAuthUser(request, env);
      if (!userId) {
        return new Response(JSON.stringify({ error: 'No autorizado' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      const data = await request.json();
      return saveLimitsHistory(env, userId, data);
    }
  }
  
  // El resto de rutas requieren autenticación
  const userId = await getAuthUser(request, env);
  if (!userId) {
    return new Response(JSON.stringify({ error: 'No autorizado' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  const accountId = url.searchParams.get('account_id');
  
  // Rutas de historial de categorías
  if (path === '/api/recategorization/history') {
    if (!accountId) {
      return new Response(JSON.stringify({ error: 'account_id requerido' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    if (request.method === 'GET') {
      return getCategoryHistory(env, accountId, userId);
    }
    if (request.method === 'POST') {
      const data = await request.json();
      return saveCategoryHistory(env, accountId, userId, data);
    }
  }
  
  // Sugerencia de categoría para un período
  if (path === '/api/recategorization/suggest') {
    if (!accountId) {
      return new Response(JSON.stringify({ error: 'account_id requerido' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const period = url.searchParams.get('period');
    if (!period) {
      return new Response(JSON.stringify({ error: 'period requerido' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    if (request.method === 'GET') {
      return calculatePeriodSuggestion(env, accountId, userId, period);
    }
  }
  
  // Ruta principal de recategorización
  if (!accountId) {
    return new Response(JSON.stringify({ error: 'account_id requerido' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  if (request.method === 'GET') {
    return getRecategorizationData(env, accountId, userId);
  }
  
  return new Response(JSON.stringify({ error: 'Método no permitido' }), {
    status: 405,
    headers: { 'Content-Type': 'application/json' }
  });
}

