function simulatorApp() {
  return {
    selectedAccountId: '',
    accounts: [],
    simulation: null,
    loading: false,
    projectionChart: null,
    
    // Custom scenario data
    customMonths: [],
    customScenario: {
      projections: [],
      exceedsCategory: false,
      exceedsMonth: null,
      newCategory: null,
      finalTotal: 0
    },
    
    // Category limits for client-side calculation
    categoryLimits: {},
    
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
            await this.loadSimulation();
          }
        }
      } catch (error) {
        console.error('Error al cargar cuentas:', error);
      }
    },
    
    async loadSimulation() {
      if (!this.selectedAccountId) {
        this.simulation = null;
        return;
      }
      
      this.loading = true;
      
      try {
        const response = await fetch(`/api/limits/simulate?account_id=${this.selectedAccountId}`, {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          }
        });
        
        if (response.ok) {
          this.simulation = await response.json();
          console.log('Simulación cargada:', this.simulation);
          
          // Store category limits
          this.categoryLimits = this.simulation.all_categories || {};
          
          // Initialize custom months with the exiting amounts from the simulation
          this.initializeCustomMonths();
          
          // Renderizar gráfico después de que Alpine actualice el DOM
          this.$nextTick(() => {
            this.renderChart();
          });
        } else {
          const errorData = await response.json().catch(() => ({}));
          console.error('Error al cargar simulación:', errorData);
          alert('Error al cargar la simulación: ' + (errorData.error || 'Error desconocido'));
        }
      } catch (error) {
        console.error('Error al cargar simulación:', error);
        alert('Error de conexión al cargar la simulación');
      } finally {
        this.loading = false;
      }
    },
    
    initializeCustomMonths() {
      if (!this.simulation?.scenarios?.maximum?.projections) return;
      
      const maxProjections = this.simulation.scenarios.maximum.projections;
      const avgMonthly = this.simulation.current?.monthly_average || 0;
      
      this.customMonths = maxProjections.map(proj => ({
        key: proj.month,
        amount: Math.round(avgMonthly), // Pre-fill with average
        exiting: proj.exiting_amount
      }));
      
      // Calculate initial custom scenario
      this.calculateCustomScenario();
    },
    
    calculateCustomScenario() {
      if (!this.simulation || this.customMonths.length === 0) return;
      
      const currentTotal = this.simulation.current?.total_billed || 0;
      const currentLimit = this.simulation.current?.limit || 0;
      const currentCategory = this.simulation.current?.category || 'H';
      
      let runningTotal = currentTotal;
      const projections = [];
      
      let exceedsCategory = false;
      let exceedsMonth = null;
      let newCategory = null;
      
      for (const month of this.customMonths) {
        const exitingAmount = month.exiting || 0;
        const newAmount = month.amount || 0;
        
        // Calculate new total
        runningTotal = runningTotal - exitingAmount + newAmount;
        
        // Determine category for this total
        const category = this.getCategoryForAmount(runningTotal);
        const exceedsCurrent = runningTotal > currentLimit;
        const exceedsAll = runningTotal > (this.categoryLimits['K'] || Infinity);
        
        let status = 'ok';
        if (exceedsAll) {
          status = 'exceeded';
        } else if (exceedsCurrent) {
          status = 'warning';
        }
        
        // Track first month that exceeds current category
        if (exceedsCurrent && !exceedsCategory) {
          exceedsCategory = true;
          exceedsMonth = month.key;
          newCategory = category;
        }
        
        projections.push({
          month: month.key,
          new_amount: newAmount,
          exiting_amount: exitingAmount,
          total: Math.round(runningTotal),
          category: category,
          status: status,
          exceeds_current: exceedsCurrent
        });
      }
      
      this.customScenario = {
        projections,
        exceedsCategory,
        exceedsMonth,
        newCategory,
        finalTotal: Math.round(runningTotal)
      };
      
      // Update chart with new custom data
      this.$nextTick(() => {
        this.renderChart();
      });
    },
    
    getCategoryForAmount(amount) {
      const sortedCategories = Object.entries(this.categoryLimits)
        .sort((a, b) => a[1] - b[1]);
      
      for (const [category, limit] of sortedCategories) {
        if (amount <= limit) {
          return category;
        }
      }
      return 'EXCEDIDO';
    },
    
    renderChart() {
      const ctx = document.getElementById('projectionChart');
      if (!ctx || !this.simulation) return;
      
      // Destruir gráfico anterior si existe
      if (this.projectionChart) {
        this.projectionChart.destroy();
      }
      
      const scenarios = this.simulation.scenarios;
      const currentLimit = this.simulation.current?.limit || 0;
      const currentTotal = this.simulation.current?.total_billed || 0;
      
      // Preparar labels (mes actual + 3 proyectados)
      const now = new Date();
      const labels = ['Actual'];
      for (let i = 1; i <= 3; i++) {
        const date = new Date(now.getFullYear(), now.getMonth() + i, 1);
        labels.push(this.formatMonth(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`));
      }
      
      // Custom scenario data
      const customData = this.customScenario.projections.length > 0
        ? [currentTotal, ...this.customScenario.projections.map(p => p.total)]
        : [currentTotal, currentTotal, currentTotal, currentTotal];
      
      // Datasets
      const datasets = [
        {
          label: 'Personalizado',
          data: customData,
          borderColor: 'rgb(236, 72, 153)',
          backgroundColor: 'rgba(236, 72, 153, 0.15)',
          tension: 0.3,
          fill: true,
          borderWidth: 3,
          pointRadius: 5,
          pointBackgroundColor: 'rgb(236, 72, 153)'
        },
        {
          label: 'Conservador',
          data: [currentTotal, ...(scenarios?.conservative?.projections?.map(p => p.total) || [])],
          borderColor: 'rgb(16, 185, 129)',
          backgroundColor: 'rgba(16, 185, 129, 0.1)',
          tension: 0.3,
          fill: false,
          borderWidth: 2
        },
        {
          label: 'Normal',
          data: [currentTotal, ...(scenarios?.normal?.projections?.map(p => p.total) || [])],
          borderColor: 'rgb(59, 130, 246)',
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          tension: 0.3,
          fill: false,
          borderWidth: 2
        },
        {
          label: 'Agresivo',
          data: [currentTotal, ...(scenarios?.aggressive?.projections?.map(p => p.total) || [])],
          borderColor: 'rgb(249, 115, 22)',
          backgroundColor: 'rgba(249, 115, 22, 0.1)',
          tension: 0.3,
          fill: false,
          borderWidth: 2
        },
        {
          label: 'Máximo',
          data: [currentTotal, ...(scenarios?.maximum?.projections?.map(p => p.total_if_max) || [])],
          borderColor: 'rgb(147, 51, 234)',
          backgroundColor: 'rgba(147, 51, 234, 0.1)',
          tension: 0.3,
          fill: false,
          borderDash: [5, 5],
          borderWidth: 2
        },
        {
          label: 'Límite categoría actual',
          data: Array(4).fill(currentLimit),
          borderColor: 'rgba(239, 68, 68, 0.7)',
          backgroundColor: 'transparent',
          borderDash: [10, 5],
          borderWidth: 2,
          pointRadius: 0,
          fill: false
        }
      ];
      
      this.projectionChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: labels,
          datasets: datasets
        },
        options: {
          responsive: true,
          interaction: {
            intersect: false,
            mode: 'index'
          },
          plugins: {
            legend: {
              display: false
            },
            tooltip: {
              callbacks: {
                label: (context) => {
                  return `${context.dataset.label}: ${this.formatCurrency(context.raw)}`;
                }
              }
            }
          },
          scales: {
            y: {
              beginAtZero: false,
              ticks: {
                callback: (value) => {
                  return this.formatCurrencyShort(value);
                }
              }
            }
          }
        }
      });
    },
    
    formatCurrency(amount) {
      if (amount === null || amount === undefined) return '-';
      return new Intl.NumberFormat('es-AR', {
        style: 'currency',
        currency: 'ARS',
        maximumFractionDigits: 0
      }).format(amount);
    },
    
    formatCurrencyShort(amount) {
      if (amount === null || amount === undefined) return '-';
      if (amount >= 1000000) {
        return '$' + (amount / 1000000).toFixed(1) + 'M';
      } else if (amount >= 1000) {
        return '$' + (amount / 1000).toFixed(0) + 'K';
      }
      return '$' + amount.toFixed(0);
    },
    
    formatMonth(monthStr) {
      if (!monthStr) return '-';
      const [year, month] = monthStr.split('-');
      const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
      return `${months[parseInt(month) - 1]} ${year.slice(2)}`;
    },
    
    logout() {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login.html';
    }
  };
}
