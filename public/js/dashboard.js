function dashboardApp() {
  return {
    selectedAccountId: '',
    accounts: [],
    invoices: [],
    invoiceLimit: 5,
    limits: {
      category: '',
      limit_amount: 0,
      total_billed: 0,
      remaining: 0,
      percentage: 0,
      alert_level: 'none',
      alert_threshold: 0.8,
      next_due_amount: null,
      next_due_date: null,
      billing_update_date: null,
      billed_amount: null
    },
    recatData: null,
    loading: false,
    revenueChart: null,
    showResetPasswordModal: false,
    resettingPassword: false,
    resetPasswordError: '',
    resetPasswordSuccess: '',
    resetPasswordForm: {
      current_password: '',
      new_password: '',
      confirm_password: ''
    },
    // Navegación del gráfico
    chartPeriodMonths: 12, // 12 o 6 meses
    chartStartMonth: null, // Mes inicial del período mostrado (null = últimos N meses)
    chartDateRange: null, // { min_date, max_date } en timestamps
    chartPeriodLabel: 'Últimos 12 meses',
    canNavigateBackward: false,
    canNavigateForward: false,
    
    async init() {
      // Verificar autenticación
      const token = localStorage.getItem('token');
      if (!token) {
        window.location.href = '/login.html';
        return;
      }
      
      await this.loadAccounts();
    },
    
    async loadAccounts() {
      try {
        const response = await fetch('/api/arca/accounts', {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          }
        });
        
        if (response.ok) {
          const data = await response.json();
          this.accounts = data.accounts || [];
          
          if (this.accounts.length > 0 && !this.selectedAccountId) {
            // Seleccionar cuenta default si existe, sino la primera
            const defaultAccount = this.accounts.find(acc => acc.is_default);
            this.selectedAccountId = defaultAccount ? defaultAccount.id : this.accounts[0].id;
            await this.loadDashboard();
          }
        }
      } catch (error) {
        console.error('Error al cargar cuentas:', error);
      }
    },
    
    async loadDashboard() {
      if (!this.selectedAccountId) return;
      
      this.loading = true;
      
      try {
        // Cargar facturas
        const invoicesResponse = await fetch(`/api/invoices?account_id=${this.selectedAccountId}&limit=${this.invoiceLimit}`, {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          }
        });
        
        if (invoicesResponse.ok) {
          const invoicesData = await invoicesResponse.json();
          this.invoices = invoicesData.invoices || [];
          
          // Si no hay facturas, mostrar mensaje informativo
          if (this.invoices.length === 0) {
            console.log('No se encontraron facturas. Esto puede ser porque:');
            console.log('1. No hay facturas en el período consultado');
            console.log('2. Hay un error al conectarse con ARCA');
            console.log('3. Las credenciales de AFIP no son correctas');
          }
        } else {
          const errorData = await invoicesResponse.json().catch(() => ({}));
          console.error('Error al cargar facturas:', errorData);
          // Mostrar error en la consola y en un alert
          const errorMsg = errorData.error || 'Error desconocido';
          console.error('Detalles del error:', errorMsg);
          alert('Error al cargar facturas:\n' + errorMsg + '\n\nRevisa la consola (F12) para más detalles.');
        }
        
        // Cargar límites
        const limitsResponse = await fetch(`/api/limits?account_id=${this.selectedAccountId}`, {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          }
        });
        
        if (limitsResponse.ok) {
          const limitsData = await limitsResponse.json();
          this.limits = limitsData;
          console.log('Límites cargados:', limitsData);
        } else {
          const errorData = await limitsResponse.json().catch(() => ({}));
          console.error('Error al cargar límites:', errorData);
        }
        
        // Cargar datos de recategorización (categoría actual y proyección)
        const recatResponse = await fetch(`/api/recategorization?account_id=${this.selectedAccountId}`, {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          }
        });
        
        if (recatResponse.ok) {
          this.recatData = await recatResponse.json();
          console.log('Recategorización cargada:', this.recatData);
        } else {
          console.error('Error al cargar recategorización');
          this.recatData = null;
        }
        
        // Cargar datos para gráfico (obtener rango de fechas disponible)
        await this.loadRevenueChart();
        
      } catch (error) {
        console.error('Error al cargar dashboard:', error);
      } finally {
        this.loading = false;
      }
    },
    
    async loadRevenueChart() {
      try {
        // Obtener facturas con rango de fechas disponible
        const response = await fetch(`/api/invoices?account_id=${this.selectedAccountId}&limit=1000`, {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          }
        });
        
        if (!response.ok) return;
        
        const data = await response.json();
        const invoices = data.invoices || [];
        
        // Guardar rango de fechas disponible
        if (data.dateRange && data.dateRange.min_date && data.dateRange.max_date) {
          this.chartDateRange = {
            min_date: data.dateRange.min_date,
            max_date: data.dateRange.max_date
          };
        } else if (invoices.length > 0) {
          // Calcular rango desde las facturas si no viene en la respuesta
          const dates = invoices.map(inv => inv.date).filter(d => d);
          if (dates.length > 0) {
            this.chartDateRange = {
              min_date: Math.min(...dates),
              max_date: Math.max(...dates)
            };
          }
        }
        
        // Si no hay rango de fechas, no hay facturas disponibles
        if (!this.chartDateRange) {
          this.chartPeriodLabel = 'Sin facturas disponibles';
          this.canNavigateBackward = false;
          this.canNavigateForward = false;
          return;
        }
        
        // Determinar el mes inicial del período a mostrar
        const now = new Date();
        let startMonth;
        
        if (this.chartStartMonth === null) {
          // Por defecto: últimos N meses desde hoy
          startMonth = new Date(now.getFullYear(), now.getMonth() - (this.chartPeriodMonths - 1), 1);
        } else {
          // Navegación: usar el mes guardado
          startMonth = new Date(this.chartStartMonth);
        }
        
        // Calcular meses a mostrar
        const monthlyData = {};
        const monthLabels = [];
        
        for (let i = 0; i < this.chartPeriodMonths; i++) {
          const date = new Date(startMonth.getFullYear(), startMonth.getMonth() + i, 1);
          const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
          monthlyData[key] = 0;
          monthLabels.push(key);
        }
        
        // Agrupar facturas por mes
        invoices.forEach(invoice => {
          const date = new Date(invoice.date * 1000);
          const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
          if (monthlyData[key] !== undefined) {
            monthlyData[key] += invoice.amount;
          }
        });
        
        const labels = monthLabels.map(key => {
          const [year, month] = key.split('-');
          const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
          return `${monthNames[parseInt(month) - 1]} ${year.slice(-2)}`;
        });
        const values = monthLabels.map(key => monthlyData[key] || 0);
        
        // Actualizar label del período
        const startLabel = labels[0];
        const endLabel = labels[labels.length - 1];
        this.chartPeriodLabel = `${startLabel} - ${endLabel}`;
        
        // Verificar si hay facturas disponibles para navegación
        const minDate = new Date(this.chartDateRange.min_date * 1000);
        const maxDate = new Date(this.chartDateRange.max_date * 1000);
        
        // Verificar si puede navegar hacia atrás (si hay facturas antes del período actual)
        const periodStart = new Date(startMonth);
        this.canNavigateBackward = periodStart > minDate;
        
        // Verificar si puede navegar hacia adelante (si hay facturas después del período actual)
        const periodEnd = new Date(startMonth.getFullYear(), startMonth.getMonth() + this.chartPeriodMonths, 0);
        this.canNavigateForward = periodEnd < maxDate;
        
        // Crear/actualizar gráfico
        const ctx = document.getElementById('revenueChart');
        if (ctx) {
          if (this.revenueChart) {
            this.revenueChart.destroy();
          }
          
          this.revenueChart = new Chart(ctx, {
            type: 'line',
            data: {
              labels: labels,
              datasets: [{
                label: 'Facturación Mensual',
                data: values,
                borderColor: 'rgb(59, 130, 246)',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                tension: 0.4
              }]
            },
            options: {
              responsive: true,
              plugins: {
                legend: {
                  display: false
                }
              },
              scales: {
                y: {
                  beginAtZero: true,
                  ticks: {
                    callback: function(value) {
                      return '$' + value.toLocaleString('es-AR');
                    }
                  }
                }
              }
            }
          });
        }
      } catch (error) {
        console.error('Error al cargar gráfico:', error);
      }
    },
    
    navigateChart(direction) {
      // direction: -1 = anterior, 1 = siguiente, 0 = resetear
      if (direction === 0) {
        // Resetear a los últimos N meses
        this.chartStartMonth = null;
      } else {
        // Navegar N meses hacia atrás o adelante
        const now = new Date();
        let currentStart;
        
        if (this.chartStartMonth === null) {
          // Estamos en los últimos N meses, calcular desde hoy
          currentStart = new Date(now.getFullYear(), now.getMonth() - (this.chartPeriodMonths - 1), 1);
        } else {
          currentStart = new Date(this.chartStartMonth);
        }
        
        // Mover el período
        const newStart = new Date(currentStart.getFullYear(), currentStart.getMonth() + (direction * this.chartPeriodMonths), 1);
        
        // Validar que no exceda el rango disponible
        if (this.chartDateRange) {
          const minDate = new Date(this.chartDateRange.min_date * 1000);
          const maxDate = new Date(this.chartDateRange.max_date * 1000);
          
          // Asegurar que el nuevo inicio no sea antes del mínimo disponible
          if (newStart < minDate) {
            this.chartStartMonth = minDate.getTime();
          } else {
            // Verificar que el período completo no exceda el máximo
            const periodEnd = new Date(newStart.getFullYear(), newStart.getMonth() + this.chartPeriodMonths, 0);
            if (periodEnd > maxDate) {
              // Ajustar para que termine en maxDate
              const adjustedStart = new Date(maxDate.getFullYear(), maxDate.getMonth() - (this.chartPeriodMonths - 1), 1);
              this.chartStartMonth = adjustedStart.getTime();
            } else {
              this.chartStartMonth = newStart.getTime();
            }
          }
        } else {
          this.chartStartMonth = newStart.getTime();
        }
      }
      
      // Recargar gráfico con nuevo período
      this.loadRevenueChart();
    },
    
    getTipoComprobante(invoice) {
      // Mapeo de códigos AFIP a texto
      const tipoMap = {
        '1': 'Factura A',
        '2': 'Nota de Débito A',
        '3': 'Nota de Crédito A',
        '6': 'Factura B',
        '7': 'Nota de Débito B',
        '8': 'Nota de Crédito B',
        '11': 'Factura C',
        '12': 'Nota de Débito C',
        '13': 'Nota de Crédito C',
        '19': 'Factura E',
        '20': 'Nota de Débito E',
        '21': 'Nota de Crédito E',
        '51': 'Factura M',
        '52': 'Nota de Débito M',
        '53': 'Nota de Crédito M',
        '81': 'Tique',
        '82': 'Tique Factura A',
        '83': 'Tique Factura B',
        '86': 'Tique Nota de Crédito A',
        '87': 'Tique Nota de Crédito B'
      };
      
      let codigo = null;
      
      // Intentar obtener desde cached_data
      if (invoice.cached_data) {
        try {
          const cached = typeof invoice.cached_data === 'string' ? JSON.parse(invoice.cached_data) : invoice.cached_data;
          if (cached.tipo) codigo = String(cached.tipo);
        } catch (e) {}
      }
      
      // Si no, intentar parsear desde arca_invoice_id (formato: TIPO-PTOVENTA-NUMERO)
      if (!codigo && invoice.arca_invoice_id) {
        const parts = invoice.arca_invoice_id.split('-');
        if (parts.length > 0) codigo = parts[0];
      }
      
      // Retornar texto del tipo o código si no está en el mapa
      if (codigo) {
        return tipoMap[codigo] || `Código ${codigo}`;
      }
      
      return '-';
    },
    
    getCuit(invoice) {
      // Intentar obtener desde cached_data
      if (invoice.cached_data) {
        try {
          const cached = typeof invoice.cached_data === 'string' ? JSON.parse(invoice.cached_data) : invoice.cached_data;
          if (cached.cuit) return cached.cuit;
        } catch (e) {}
      }
      return null;
    },
    
    formatCurrency(amount) {
      return new Intl.NumberFormat('es-AR', {
        style: 'currency',
        currency: 'ARS'
      }).format(amount || 0);
    },
    
    formatDate(timestamp) {
      return new Date(timestamp * 1000).toLocaleDateString('es-AR');
    },
    
    async resetPassword() {
      if (this.resetPasswordForm.new_password !== this.resetPasswordForm.confirm_password) {
        this.resetPasswordError = 'Las contraseñas no coinciden';
        this.resetPasswordSuccess = '';
        return;
      }
      
      if (this.resetPasswordForm.new_password.length < 6) {
        this.resetPasswordError = 'La contraseña debe tener al menos 6 caracteres';
        this.resetPasswordSuccess = '';
        return;
      }
      
      this.resettingPassword = true;
      this.resetPasswordError = '';
      this.resetPasswordSuccess = '';
      
      try {
        const response = await fetch('/api/auth/reset-password', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          },
          body: JSON.stringify({
            current_password: this.resetPasswordForm.current_password,
            new_password: this.resetPasswordForm.new_password
          })
        });
        
        const data = await response.json();
        
        if (response.ok) {
          this.resetPasswordSuccess = data.message || 'Contraseña actualizada correctamente';
          this.resetPasswordError = '';
          setTimeout(() => {
            this.showResetPasswordModal = false;
            this.resetPasswordForm = { current_password: '', new_password: '', confirm_password: '' };
            this.resetPasswordError = '';
            this.resetPasswordSuccess = '';
          }, 2000);
        } else {
          this.resetPasswordError = data.error || 'Error al actualizar contraseña';
          this.resetPasswordSuccess = '';
        }
      } catch (error) {
        console.error('Error al resetear contraseña:', error);
        this.resetPasswordError = 'Error de conexión';
        this.resetPasswordSuccess = '';
      } finally {
        this.resettingPassword = false;
      }
    },
    
    logout() {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login.html';
    }
  };
}

