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
        
        // Cargar datos para gráfico
        await this.loadRevenueChart();
        
      } catch (error) {
        console.error('Error al cargar dashboard:', error);
      } finally {
        this.loading = false;
      }
    },
    
    async loadRevenueChart() {
      try {
        // Obtener facturas de últimos 12 meses para el gráfico
        const response = await fetch(`/api/invoices?account_id=${this.selectedAccountId}&limit=100`, {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          }
        });
        
        if (!response.ok) return;
        
        const data = await response.json();
        const invoices = data.invoices || [];
        
        // Agrupar por mes
        const monthlyData = {};
        const now = new Date();
        
        for (let i = 11; i >= 0; i--) {
          const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
          const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
          monthlyData[key] = 0;
        }
        
        invoices.forEach(invoice => {
          const date = new Date(invoice.date * 1000);
          const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
          if (monthlyData[key] !== undefined) {
            monthlyData[key] += invoice.amount;
          }
        });
        
        const labels = Object.keys(monthlyData);
        const values = Object.values(monthlyData);
        
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
    
    logout() {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login.html';
    }
  };
}

