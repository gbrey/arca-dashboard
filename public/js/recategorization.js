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
    
    // Historial de categorías
    categoryHistory: [],
    showHistoryForm: false,
    historyError: '',
    historyLoading: false,
    historySuggestion: null,
    newHistory: {
      period: '',
      category: '',
      total_billed: null,
      notes: ''
    },
    
    // Historial de límites
    limitsHistory: [],
    showLimitsForm: false,
    limitsError: '',
    newLimits: {
      period: '',
      valid_from: '',
      limits: {
        A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, G: 0, H: 0, I: 0, J: 0, K: 0
      }
    },
    
    // Períodos disponibles para seleccionar (últimos 3 años y próximo)
    get availablePeriods() {
      const periods = [];
      const currentYear = new Date().getFullYear();
      
      for (let year = currentYear + 1; year >= currentYear - 3; year--) {
        periods.push({ value: `${year}-07`, label: `Julio ${year}` });
        periods.push({ value: `${year}-01`, label: `Enero ${year}` });
      }
      
      return periods;
    },
    
    async init() {
      // Verificar autenticación
      const token = localStorage.getItem('token');
      if (!token) {
        window.location.href = '/login.html';
        return;
      }
      
      await this.loadAccounts();
      await this.loadLimitsHistory();
      
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
        this.categoryHistory = [];
        return;
      }
      
      this.loading = true;
      
      // Guardar selección
      localStorage.setItem('selectedAccountId', this.selectedAccountId);
      
      try {
        // Cargar datos de recategorización
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
        
        // Cargar historial de categorías
        await this.loadCategoryHistory();
        
      } catch (error) {
        console.error('Error loading recategorization data:', error);
      }
      
      this.loading = false;
    },
    
    async loadCategoryHistory() {
      try {
        const response = await fetch(`/api/recategorization/history?account_id=${this.selectedAccountId}`, {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          }
        });
        
        if (response.ok) {
          const data = await response.json();
          this.categoryHistory = data.history || [];
        }
      } catch (error) {
        console.error('Error loading category history:', error);
      }
    },
    
    async loadLimitsHistory() {
      try {
        // Solo cargar el último límite vigente
        const response = await fetch('/api/recategorization/limits?only_latest=true', {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          }
        });
        
        if (response.ok) {
          const data = await response.json();
          this.limitsHistory = data.limits || [];
        }
      } catch (error) {
        console.error('Error loading limits history:', error);
      }
    },
    
    async saveHistory() {
      this.historyError = '';
      
      if (!this.newHistory.period || !this.newHistory.category) {
        this.historyError = 'Período y categoría son requeridos';
        return;
      }
      
      try {
        const response = await fetch(`/api/recategorization/history?account_id=${this.selectedAccountId}`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(this.newHistory)
        });
        
        if (response.ok) {
          await this.loadCategoryHistory();
          await this.loadData(); // Recargar datos para actualizar categoría actual
          this.showHistoryForm = false;
          this.newHistory = { period: '', category: '', total_billed: null, notes: '' };
          this.historySuggestion = null;
        } else {
          const error = await response.json();
          this.historyError = error.error || 'Error al guardar';
        }
      } catch (error) {
        this.historyError = 'Error de conexión';
      }
    },
    
    async onPeriodChange() {
      if (!this.newHistory.period || !this.selectedAccountId) {
        this.historySuggestion = null;
        return;
      }
      
      this.historyLoading = true;
      this.historySuggestion = null;
      
      try {
        const response = await fetch(
          `/api/recategorization/suggest?account_id=${this.selectedAccountId}&period=${this.newHistory.period}`,
          {
            headers: {
              'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
          }
        );
        
        if (response.ok) {
          this.historySuggestion = await response.json();
          
          // Auto-completar los campos con la sugerencia
          if (this.historySuggestion.hasData) {
            this.newHistory.total_billed = this.historySuggestion.totalBilled;
            this.newHistory.category = this.historySuggestion.suggestedCategory;
          }
        }
      } catch (error) {
        console.error('Error fetching suggestion:', error);
      }
      
      this.historyLoading = false;
    },
    
    applySuggestion() {
      if (this.historySuggestion) {
        this.newHistory.total_billed = this.historySuggestion.totalBilled;
        this.newHistory.category = this.historySuggestion.suggestedCategory;
      }
    },
    
    async saveLimits() {
      this.limitsError = '';
      
      if (!this.newLimits.period || !this.newLimits.valid_from) {
        this.limitsError = 'Período y fecha de vigencia son requeridos';
        return;
      }
      
      // Validar que todos los límites estén completos
      for (const cat of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K']) {
        if (!this.newLimits.limits[cat] || this.newLimits.limits[cat] <= 0) {
          this.limitsError = `Límite para categoría ${cat} es requerido`;
          return;
        }
      }
      
      try {
        const response = await fetch('/api/recategorization/limits', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(this.newLimits)
        });
        
        if (response.ok) {
          await this.loadLimitsHistory();
          this.showLimitsForm = false;
          this.newLimits = {
            period: '',
            valid_from: '',
            limits: { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, G: 0, H: 0, I: 0, J: 0, K: 0 }
          };
        } else {
          const error = await response.json();
          this.limitsError = error.error || 'Error al guardar';
        }
      } catch (error) {
        this.limitsError = 'Error de conexión';
      }
    },
    
    copyCurrentLimits() {
      if (this.data && this.data.allCategories) {
        this.newLimits.limits = { ...this.data.allCategories };
      }
    },
    
    editLimits(item) {
      // Cargar los datos del item en el formulario
      const validFromDate = new Date(item.valid_from * 1000);
      const dateStr = validFromDate.toISOString().split('T')[0]; // formato YYYY-MM-DD
      
      this.newLimits = {
        period: item.period,
        valid_from: dateStr,
        limits: { ...item.limits }
      };
      this.showLimitsForm = true;
      this.limitsError = '';
    },
    
    editHistory(item) {
      // Cargar los datos del item en el formulario
      this.newHistory = {
        period: item.period,
        category: item.category,
        total_billed: item.total_billed || null,
        notes: item.notes || ''
      };
      this.historySuggestion = null;
      this.showHistoryForm = true;
      this.historyError = '';
      // Cargar sugerencia para el período
      this.onPeriodChange();
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
    
    formatPeriod(period) {
      if (!period) return '';
      const [year, month] = period.split('-');
      return month === '01' ? `Enero ${year}` : `Julio ${year}`;
    },
    
    getCategoryColor(category) {
      const colors = {
        'A': 'bg-green-100 text-green-800',
        'B': 'bg-green-100 text-green-800',
        'C': 'bg-emerald-100 text-emerald-800',
        'D': 'bg-teal-100 text-teal-800',
        'E': 'bg-cyan-100 text-cyan-800',
        'F': 'bg-sky-100 text-sky-800',
        'G': 'bg-blue-100 text-blue-800',
        'H': 'bg-indigo-100 text-indigo-800',
        'I': 'bg-violet-100 text-violet-800',
        'J': 'bg-purple-100 text-purple-800',
        'K': 'bg-fuchsia-100 text-fuchsia-800'
      };
      return colors[category] || 'bg-gray-100 text-gray-800';
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
