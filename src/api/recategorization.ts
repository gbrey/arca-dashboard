import { Env, BillingLimit } from '../utils/db';
import { getAuthUser } from './auth';
import { MONOTRIBUTO_LIMITS } from './limits';

// Determinar la categoría correspondiente a un monto total
function getCategoryForAmount(amount: number): string {
  const categories = Object.entries(MONOTRIBUTO_LIMITS).sort((a, b) => a[1] - b[1]);
  for (const [category, limit] of categories) {
    if (amount <= limit) {
      return category;
    }
  }
  return 'EXCEDIDO';
}

// Obtener información de una categoría
function getCategoryInfo(category: string) {
  const categories = Object.keys(MONOTRIBUTO_LIMITS);
  const index = categories.indexOf(category);
  return {
    category,
    limit: MONOTRIBUTO_LIMITS[category] || 0,
    index,
    nextCategory: index < categories.length - 1 ? categories[index + 1] : null,
    prevCategory: index > 0 ? categories[index - 1] : null,
    nextLimit: index < categories.length - 1 ? MONOTRIBUTO_LIMITS[categories[index + 1]] : null,
    prevLimit: index > 0 ? MONOTRIBUTO_LIMITS[categories[index - 1]] : null
  };
}

// Calcular los períodos de recategorización
function getRecategorizationPeriods(now: Date) {
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
  const timeline = [];
  const currentYear = now.getFullYear();
  
  // Últimas 2 recategorizaciones pasadas
  for (let i = 2; i >= 1; i--) {
    // Enero pasado
    if (now.getMonth() >= 0) {
      timeline.push({
        date: new Date(currentYear - i + 1, 0, 20),
        type: 'january',
        label: `Ene ${currentYear - i + 1}`,
        status: 'past',
        category: null // No sabemos la categoría pasada
      });
    }
    // Julio pasado
    if (now.getMonth() >= 6 || i > 1) {
      timeline.push({
        date: new Date(currentYear - i + 1, 6, 20),
        type: 'july', 
        label: `Jul ${currentYear - i + 1}`,
        status: 'past',
        category: null
      });
    }
  }
  
  // Próximas 4 recategorizaciones
  for (let i = 0; i < 4; i++) {
    const year = currentYear + Math.floor((now.getMonth() + i * 6) / 12);
    const isJanuary = (i % 2 === 0 && now.getMonth() < 1) || (i % 2 === 1 && now.getMonth() >= 1);
    
    if (i < 2) {
      // Próxima enero
      const nextJanYear = now.getMonth() >= 1 ? currentYear + 1 : currentYear;
      timeline.push({
        date: new Date(nextJanYear + Math.floor(i / 2), 0, 20),
        type: 'january',
        label: `Ene ${nextJanYear + Math.floor(i / 2)}`,
        status: i === 0 ? 'next' : 'future',
        category: null
      });
      
      // Próxima julio
      const nextJulYear = now.getMonth() >= 7 ? currentYear + 1 : currentYear;
      timeline.push({
        date: new Date(nextJulYear + Math.floor(i / 2), 6, 20),
        type: 'july',
        label: `Jul ${nextJulYear + Math.floor(i / 2)}`,
        status: i === 0 ? 'next' : 'future',
        category: null
      });
    }
  }
  
  // Ordenar y filtrar duplicados
  timeline.sort((a, b) => a.date.getTime() - b.date.getTime());
  
  // Marcar la actual
  const nowTime = now.getTime();
  let foundNext = false;
  for (const item of timeline) {
    if (!foundNext && item.date.getTime() > nowTime) {
      item.status = 'next';
      foundNext = true;
    } else if (item.date.getTime() <= nowTime) {
      item.status = 'past';
    } else if (foundNext) {
      item.status = 'future';
    }
  }
  
  return timeline.slice(0, 8); // Últimas 8 entradas
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
    
    // Obtener categoría actual
    const limit = await env.DB.prepare(
      'SELECT * FROM billing_limits WHERE arca_account_id = ?'
    ).bind(accountId).first<BillingLimit>();
    
    const currentCategory = limit?.category || 'H';
    const currentCategoryInfo = getCategoryInfo(currentCategory);
    
    const now = new Date();
    const periods = getRecategorizationPeriods(now);
    
    // Importar función para calcular monto ajustado
    const { calcularMontoAjustado } = await import('../utils/comprobantes');
    
    // Calcular totales para cada período
    const periodResults = [];
    
    for (const period of periods) {
      const startTimestamp = Math.floor(period.periodStart.getTime() / 1000);
      const endTimestamp = Math.floor(period.periodEnd.getTime() / 1000);
      
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
      
      // Determinar categoría proyectada
      const projectedCategory = getCategoryForAmount(projectedTotal);
      const projectedCategoryInfo = getCategoryInfo(projectedCategory);
      
      // Calcular máximo facturable para mantenerse en categoría actual
      const currentLimit = MONOTRIBUTO_LIMITS[currentCategory] || 0;
      const remainingToLimit = Math.max(0, currentLimit - periodTotal);
      const maxMonthlyToStay = monthsRemaining > 0 ? remainingToLimit / monthsRemaining : 0;
      
      // Determinar si sube, baja o se mantiene
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
        projectedCategoryLimit: MONOTRIBUTO_LIMITS[projectedCategory] || 0,
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
      allCategories: MONOTRIBUTO_LIMITS,
      
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

export async function handleRecategorization(request: Request, env: Env): Promise<Response> {
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
  
  if (request.method === 'GET') {
    return getRecategorizationData(env, accountId, userId);
  }
  
  return new Response(JSON.stringify({ error: 'Método no permitido' }), {
    status: 405,
    headers: { 'Content-Type': 'application/json' }
  });
}

