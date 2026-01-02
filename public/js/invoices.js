function invoicesApp() {
  return {
    selectedAccountId: '',
    accounts: [],
    invoices: [],
    filteredInvoices: [],
    searchFilter: '',
    sortBy: 'date-desc',
    templates: [],
    newInvoice: {
      description: '',
      amount: '',
      date: new Date().toISOString().split('T')[0]
    },
    loading: false,
    syncing: false,
    error: '',
    success: '',
    
    async init() {
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
            this.selectedAccountId = this.accounts[0].id;
            await this.loadInvoices();
          }
        }
      } catch (error) {
        console.error('Error al cargar cuentas:', error);
      }
    },
    
    async loadInvoices() {
      if (!this.selectedAccountId) return;
      
      this.loading = true;
      
      try {
        const response = await fetch(`/api/invoices?account_id=${this.selectedAccountId}`, {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          }
        });
        
        if (response.ok) {
          const data = await response.json();
          this.invoices = data.invoices || [];
          // Inicializar filteredInvoices con todas las facturas
          this.filteredInvoices = [...this.invoices];
          // Aplicar filtros y ordenamiento
          this.filterInvoices();
        }
      } catch (error) {
        console.error('Error al cargar facturas:', error);
      } finally {
        this.loading = false;
      }
    },
    
    // createInvoice() - Temporalmente deshabilitado, se probará desde desarrollo de AFIP
    async createInvoice() {
      this.error = 'La funcionalidad de emitir facturas está temporalmente deshabilitada. Se probará desde desarrollo de AFIP.';
      return;
      /* 
      if (!this.selectedAccountId) {
        this.error = 'Selecciona una cuenta ARCA';
        return;
      }
      
      this.loading = true;
      this.error = '';
      this.success = '';
      
      try {
        const response = await fetch('/api/invoices', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          },
          body: JSON.stringify({
            account_id: this.selectedAccountId,
            description: this.newInvoice.description,
            amount: parseFloat(this.newInvoice.amount),
            date: this.newInvoice.date
          })
        });
        
        const data = await response.json();
        
        if (response.ok) {
          this.success = 'Factura emitida correctamente';
          this.newInvoice = {
            description: '',
            amount: '',
            date: new Date().toISOString().split('T')[0]
          };
          await this.loadInvoices();
        } else {
          this.error = data.error || 'Error al emitir factura';
        }
      } catch (error) {
        this.error = 'Error de conexión';
      } finally {
        this.loading = false;
      }
      */
    },
    
    async updateAmount(invoiceId, newAmount) {
      if (!this.selectedAccountId) return;
      
      try {
        const response = await fetch(`/api/invoices/${invoiceId}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          },
          body: JSON.stringify({
            account_id: this.selectedAccountId,
            amount: parseFloat(newAmount)
          })
        });
        
        if (response.ok) {
          await this.loadInvoices();
        } else {
          alert('Error al actualizar monto');
        }
      } catch (error) {
        console.error('Error:', error);
        alert('Error al actualizar monto');
      }
    },
    
    async updateDescription(invoiceId, newDescription) {
      // Actualizar solo en cache local por ahora
      // En producción, esto podría requerir una API específica
      console.log('Actualizar descripción:', invoiceId, newDescription);
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
    
    async syncInvoices() {
      if (!this.selectedAccountId) {
        this.error = 'Selecciona una cuenta ARCA';
        return;
      }
      
      this.syncing = true;
      this.error = '';
      this.success = '';
      
      try {
        const response = await fetch('/api/invoices/sync', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          },
          body: JSON.stringify({
            account_id: this.selectedAccountId
          })
        });
        
        const data = await response.json();
        
        if (response.ok) {
          this.success = data.message || `Se sincronizaron ${data.count || 0} facturas nuevas`;
          await this.loadInvoices();
        } else {
          this.error = data.error || 'Error al sincronizar facturas';
        }
      } catch (error) {
        console.error('Error al sincronizar:', error);
        this.error = 'Error de conexión al sincronizar';
      } finally {
        this.syncing = false;
      }
    },
    
    async loadTemplates() {
      // Cargar plantillas guardadas (implementar si es necesario)
      console.log('Cargar plantillas');
    },
    
    formatDate(timestamp) {
      return new Date(timestamp * 1000).toLocaleDateString('es-AR');
    },
    
    formatCurrency(amount) {
      return new Intl.NumberFormat('es-AR', {
        style: 'currency',
        currency: 'ARS'
      }).format(amount || 0);
    },
    
    filterInvoices() {
      let filtered = [...this.invoices];
      
      // Aplicar filtro de búsqueda
      if (this.searchFilter) {
        const search = this.searchFilter.toLowerCase();
        filtered = filtered.filter(invoice => {
          const description = (invoice.description || '').toLowerCase();
          const invoiceId = (invoice.arca_invoice_id || '').toLowerCase();
          return description.includes(search) || invoiceId.includes(search);
        });
      }
      
      // Aplicar ordenamiento
      this.sortInvoices(filtered);
    },
    
    sortInvoices(invoicesToSort = null) {
      let invoices = invoicesToSort ? [...invoicesToSort] : [...this.invoices];
      
      // Si hay filtro de búsqueda, aplicar primero
      if (this.searchFilter && !invoicesToSort) {
        const search = this.searchFilter.toLowerCase();
        invoices = invoices.filter(invoice => {
          const description = (invoice.description || '').toLowerCase();
          const invoiceId = (invoice.arca_invoice_id || '').toLowerCase();
          return description.includes(search) || invoiceId.includes(search);
        });
      }
      
      const [field, direction] = this.sortBy.split('-');
      
      invoices.sort((a, b) => {
        let aValue, bValue;
        
        switch (field) {
          case 'date':
            aValue = a.date || 0;
            bValue = b.date || 0;
            break;
          case 'amount':
            aValue = a.amount || 0;
            bValue = b.amount || 0;
            break;
          case 'description':
            aValue = (a.description || '').toLowerCase();
            bValue = (b.description || '').toLowerCase();
            break;
          default:
            return 0;
        }
        
        if (field === 'description') {
          // Ordenamiento alfabético
          if (direction === 'asc') {
            return aValue.localeCompare(bValue);
          } else {
            return bValue.localeCompare(aValue);
          }
        } else {
          // Ordenamiento numérico
          if (direction === 'asc') {
            return aValue - bValue;
          } else {
            return bValue - aValue;
          }
        }
      });
      
      this.filteredInvoices = invoices;
    },
    
    logout() {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login.html';
    }
  };
}

