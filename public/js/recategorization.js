function recategorizationApp() {
  return {
    accounts: [],
    selectedAccountId: '',
    loading: true,
    data: null,
    
    // Simulador
    simulatorAmount: 0,
    simulatorPeriod: 'january',
    simulatorResult: null,
    
    async init() {
      // Verificar autenticación
      const token = localStorage.getItem('token');
      if (!token) {
        window.location.href = '/login.html';
        return;
      }
      
      await this.loadAccounts();
      
      // Cargar cuenta guardada
      const savedAccountId = localStorage.getItem('selectedAccountId');
      if (savedAccountId) {
        this.selectedAccountId = savedAccountId;
        await this.loadData();
      } else if (this.accounts.length > 0) {
        // Usar cuenta default o la primera
        const defaultAccount = this.accounts.find(a => a.is_default);
        this.selectedAccountId = defaultAccount ? defaultAccount.id : this.accounts[0].id;
        await this.loadData();
      }
      
      this.loading = false;
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
        }
      } catch (error) {
        console.error('Error loading accounts:', error);
      }
    },
    
    async loadData() {
      if (!this.selectedAccountId) {
        this.data = null;
        return;
      }
      
      this.loading = true;
      
      // Guardar selección
      localStorage.setItem('selectedAccountId', this.selectedAccountId);
      
      try {
        const response = await fetch(`/api/recategorization?account_id=${this.selectedAccountId}`, {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          }
        });
        
        if (response.ok) {
          this.data = await response.json();
          console.log('Recategorization data:', this.data);
          
          // Inicializar simulador con promedio actual
          if (this.data.nextRecategorization) {
            this.simulatorAmount = this.data.nextRecategorization.monthlyAverage || 0;
            this.simulatorPeriod = this.data.nextRecategorization.id;
          }
        } else {
          const error = await response.json();
          console.error('Error loading data:', error);
        }
      } catch (error) {
        console.error('Error loading recategorization data:', error);
      }
      
      this.loading = false;
    },
    
    runSimulation() {
      if (!this.data || !this.simulatorAmount || !this.simulatorPeriod) {
        this.simulatorResult = null;
        return;
      }
      
      // Encontrar el período seleccionado
      const period = this.data.periods.find(p => p.id === this.simulatorPeriod);
      if (!period) {
        this.simulatorResult = null;
        return;
      }
      
      // Calcular total proyectado
      const monthsRemaining = period.monthsRemaining || 1;
      const projectedTotal = period.currentTotal + (this.simulatorAmount * monthsRemaining);
      
      // Determinar categoría
      const category = this.getCategoryForAmount(projectedTotal);
      const currentIndex = Object.keys(this.data.allCategories).indexOf(this.data.currentCategory);
      const projectedIndex = Object.keys(this.data.allCategories).indexOf(category);
      
      let trend = 'same';
      if (projectedIndex > currentIndex) {
        trend = 'up';
      } else if (projectedIndex < currentIndex) {
        trend = 'down';
      }
      
      this.simulatorResult = {
        total: projectedTotal,
        category: category,
        trend: trend
      };
    },
    
    getCategoryForAmount(amount) {
      if (!this.data || !this.data.allCategories) return 'H';
      
      const categories = Object.entries(this.data.allCategories).sort((a, b) => a[1] - b[1]);
      for (const [category, limit] of categories) {
        if (amount <= limit) {
          return category;
        }
      }
      return 'EXCEDIDO';
    },
    
    getTrendClass(trend) {
      if (trend === 'up') return 'trend-up';
      if (trend === 'down') return 'trend-down';
      return 'trend-same';
    },
    
    formatCurrency(amount) {
      if (!amount) return '$0';
      return new Intl.NumberFormat('es-AR', {
        style: 'currency',
        currency: 'ARS',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      }).format(amount);
    },
    
    formatCurrencyShort(amount) {
      if (!amount) return '$0';
      if (amount >= 1000000) {
        return '$' + (amount / 1000000).toFixed(1) + 'M';
      }
      if (amount >= 1000) {
        return '$' + (amount / 1000).toFixed(0) + 'K';
      }
      return '$' + amount.toFixed(0);
    },
    
    logout() {
      localStorage.removeItem('token');
      localStorage.removeItem('selectedAccountId');
      window.location.href = '/login.html';
    }
  };
}

