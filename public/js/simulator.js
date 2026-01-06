function simulatorApp() {
  return {
    selectedAccountId: '',
    accounts: [],
    // Inicializar con estructura vacía para evitar errores de null
    simulation: {
      current: null,
      scenarios: null,
      all_categories: {},
      months_data: []
    },
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
    
    // Debounce timer for chart rendering
    chartRenderTimeout: null,
    
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
        this.simulation = {
          current: null,
          scenarios: null,
          all_categories: {},
          months_data: []
        };
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
      
      // Calculate initial custom scenario (sin renderizar gráfico, se hace después)
      this.calculateCustomScenario(false);
    },
    
    calculateCustomScenario(shouldRenderChart = true) {
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
      
      // Update chart with new custom data (solo si no es la carga inicial)
      // Usar debounce para evitar recrear el gráfico muchas veces seguidas
      if (shouldRenderChart) {
        console.log('calculateCustomScenario: scheduling chart render');
        if (this.chartRenderTimeout) {
          console.log('calculateCustomScenario: clearing previous timeout');
          clearTimeout(this.chartRenderTimeout);
        }
        this.chartRenderTimeout = setTimeout(() => {
          console.log('calculateCustomScenario: timeout fired, calling renderChart');
          this.renderChart();
        }, 300); // Aumentar a 300ms
      }
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
      console.log('>>> renderChart START');
      
      const canvas = document.getElementById('projectionChart');
      console.log('renderChart: canvas element:', canvas);
      console.log('renderChart: existing chart:', this.projectionChart);
      
      if (!canvas) {
        console.log('renderChart: NO CANVAS ELEMENT');
        return;
      }
      
      if (!this.simulation || !this.simulation.current) {
        console.log('renderChart: missing simulation data');
        return;
      }
      
      // Destruir gráfico anterior si existe
      if (this.projectionChart) {
        console.log('renderChart: stopping and destroying existing chart...');
        try {
          // Detener animaciones primero para evitar requestAnimationFrame huérfanos
          this.projectionChart.stop();
          this.projectionChart.destroy();
          console.log('renderChart: chart stopped and destroyed successfully');
        } catch (e) {
          console.log('renderChart: Error destroying chart:', e);
        }
        this.projectionChart = null;
      }
      
      // Verificar que el canvas tenga contexto válido
      if (!canvas.getContext) {
        console.log('renderChart: Canvas element is invalid (no getContext)');
        return;
      }
      
      console.log('renderChart: canvas is valid, proceeding...');
      
      const scenarios = this.simulation.scenarios;
      const currentLimit = this.simulation.current?.limit || 0;
      const currentTotal = this.simulation.current?.total_billed || 0;
      
      // Usar los meses del primer escenario disponible para los labels
      const projectionMonths = scenarios?.conservative?.projections || 
                               scenarios?.normal?.projections || 
                               scenarios?.maximum?.projections || [];
      
      // Si no hay proyecciones, generar labels manualmente
      let labels;
      if (projectionMonths.length > 0) {
        labels = projectionMonths.map(p => this.formatMonth(p.month));
      } else {
        const now = new Date();
        labels = [];
        for (let i = 0; i <= 2; i++) {
          const date = new Date(now.getFullYear(), now.getMonth() + i, 1);
          labels.push(this.formatMonth(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`));
        }
      }
      
      const numPoints = labels.length;
      
      // Custom scenario data
      const customData = this.customScenario.projections.length > 0
        ? this.customScenario.projections.map(p => p.total)
        : Array(numPoints).fill(currentTotal);
      
      // Helper to get data or fallback
      const getProjectionData = (projections, key = 'total') => {
        if (!projections || projections.length === 0) {
          console.log(`getProjectionData: no projections, returning fallback`);
          return Array(numPoints).fill(currentTotal);
        }
        const result = projections.map(p => p[key]);
        console.log(`getProjectionData(key=${key}):`, JSON.stringify(result));
        return result;
      };
      
      // Datasets - ordenados para que no se tapen entre sí
      // Las líneas sin fill primero, luego la línea con fill al final
      const datasets = [
        {
          label: 'Límite categoría actual',
          data: Array(numPoints).fill(currentLimit),
          borderColor: 'rgba(239, 68, 68, 0.8)',
          backgroundColor: 'transparent',
          borderDash: [10, 5],
          borderWidth: 2,
          pointRadius: 0,
          fill: false,
          order: 6
        },
        {
          label: 'Conservador',
          data: getProjectionData(scenarios?.conservative?.projections),
          borderColor: 'rgb(16, 185, 129)',
          backgroundColor: 'transparent',
          tension: 0.3,
          fill: false,
          borderWidth: 3,
          pointRadius: 5,
          order: 5
        },
        {
          label: 'Normal',
          data: getProjectionData(scenarios?.normal?.projections),
          borderColor: 'rgb(59, 130, 246)',
          backgroundColor: 'transparent',
          tension: 0.3,
          fill: false,
          borderWidth: 3,
          pointRadius: 5,
          order: 4
        },
        {
          label: 'Agresivo',
          data: getProjectionData(scenarios?.aggressive?.projections),
          borderColor: 'rgb(249, 115, 22)',
          backgroundColor: 'transparent',
          tension: 0.3,
          fill: false,
          borderWidth: 3,
          pointRadius: 5,
          order: 3
        },
        {
          label: 'Máximo',
          data: getProjectionData(scenarios?.maximum?.projections, 'total_if_max'),
          borderColor: 'rgb(147, 51, 234)',
          backgroundColor: 'transparent',
          tension: 0.3,
          fill: false,
          borderDash: [5, 5],
          borderWidth: 3,
          pointRadius: 5,
          order: 2
        },
        {
          label: 'Personalizado',
          data: customData,
          borderColor: 'rgb(236, 72, 153)',
          backgroundColor: 'rgba(236, 72, 153, 0.1)',
          tension: 0.3,
          fill: true,
          borderWidth: 3,
          pointRadius: 6,
          pointBackgroundColor: 'rgb(236, 72, 153)',
          order: 1
        }
      ];
      
      // Debug: log cada dataset individualmente con valores exactos
      console.log('=== CHART DEBUG ===');
      console.log('Labels:', JSON.stringify(labels));
      console.log('currentLimit:', currentLimit);
      console.log('currentTotal:', currentTotal);
      datasets.forEach((d, i) => {
        console.log(`Dataset ${i} [${d.label}]: data=${JSON.stringify(d.data)}, color=${d.borderColor}`);
      });
      
      // Calcular min y max de todos los datasets para escala Y correcta
      const allValues = datasets.flatMap(d => d.data).filter(v => v != null && !isNaN(v));
      const minValue = Math.min(...allValues);
      const maxValue = Math.max(...allValues);
      const padding = (maxValue - minValue) * 0.1; // 10% padding
      
      console.log(`Y-axis: min=${minValue}, max=${maxValue}, padding=${padding}`);
      
      try {
        this.projectionChart = new Chart(canvas, {
          type: 'line',
          data: {
            labels: labels,
            datasets: datasets
          },
          options: {
            responsive: true,
            maintainAspectRatio: true,
            animation: false, // Desactivar animaciones para evitar errores al actualizar
            interaction: {
              intersect: false,
              mode: 'index'
            },
            plugins: {
              legend: {
                display: true,
                position: 'bottom',
                labels: {
                  usePointStyle: true,
                  padding: 15
                }
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
                // Dejar que Chart.js calcule el rango automáticamente
                ticks: {
                  callback: (value) => {
                    return this.formatCurrencyShort(value);
                  }
                }
              }
            }
          }
        });
        console.log('>>> renderChart END - Chart created successfully');
        console.log('>>> Chart instance:', this.projectionChart);
      } catch (error) {
        console.error('>>> renderChart ERROR:', error);
        console.error('>>> Error stack:', error.stack);
      }
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
