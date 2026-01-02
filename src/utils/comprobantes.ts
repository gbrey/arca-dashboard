// Mapeo de códigos AFIP de tipos de comprobantes a texto
// Fuente: https://www.afip.gob.ar/fe/documentos/codigos-tipo-comprobante.pdf

export const TIPO_COMPROBANTE_MAP: Record<string, string> = {
  // Facturas A
  '1': 'Factura A',
  '2': 'Nota de Débito A',
  '3': 'Nota de Crédito A',
  
  // Facturas B
  '6': 'Factura B',
  '7': 'Nota de Débito B',
  '8': 'Nota de Crédito B',
  
  // Facturas C
  '11': 'Factura C',
  '12': 'Nota de Débito C',
  '13': 'Nota de Crédito C',
  
  // Facturas E (Exenta)
  '19': 'Factura E',
  '20': 'Nota de Débito E',
  '21': 'Nota de Crédito E',
  
  // Facturas M (Monotributo)
  '51': 'Factura M',
  '52': 'Nota de Débito M',
  '53': 'Nota de Crédito M',
  
  // Facturas T (Ticket)
  '83': 'Tique Factura B',
  '87': 'Tique Nota de Crédito B',
  
  // Otros
  '81': 'Tique',
  '82': 'Tique Factura A',
  '86': 'Tique Nota de Crédito A',
};

// Códigos de notas de crédito (restan del total)
export const NOTAS_CREDITO = ['3', '8', '13', '21', '53', '63', '87', '86'];

// Códigos de notas de débito (suman al total)
export const NOTAS_DEBITO = ['2', '7', '12', '20', '52', '62'];

/**
 * Obtiene el nombre del tipo de comprobante desde su código
 */
export function getTipoComprobanteTexto(codigo: string | number | null | undefined): string {
  if (!codigo) return '-';
  const codigoStr = String(codigo);
  return TIPO_COMPROBANTE_MAP[codigoStr] || `Código ${codigoStr}`;
}

/**
 * Determina si un comprobante es nota de crédito (resta del total)
 */
export function esNotaCredito(codigo: string | number | null | undefined): boolean {
  if (!codigo) return false;
  return NOTAS_CREDITO.includes(String(codigo));
}

/**
 * Determina si un comprobante es nota de débito (suma al total)
 */
export function esNotaDebito(codigo: string | number | null | undefined): boolean {
  if (!codigo) return false;
  return NOTAS_DEBITO.includes(String(codigo));
}

/**
 * Calcula el monto ajustado según el tipo de comprobante
 * - Notas de crédito: monto negativo (resta)
 * - Notas de débito y facturas: monto positivo (suma)
 */
export function calcularMontoAjustado(
  monto: number,
  tipoComprobante: string | number | null | undefined
): number {
  if (esNotaCredito(tipoComprobante)) {
    return -Math.abs(monto); // Nota de crédito resta
  }
  return Math.abs(monto); // Factura o nota de débito suma
}

