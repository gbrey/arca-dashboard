function simulatorApp() {
  return {
    selectedAccountId: '',
    accounts: [],
    simulation: null,
    loading: false,
    projectionChart: null,
    
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
      
      // Datasets
      const datasets = [
        {
          label: 'Conservador',
          data: [currentTotal, ...(scenarios?.conservative?.projections?.map(p => p.total) || [])],
          borderColor: 'rgb(16, 185, 129)',
          backgroundColor: 'rgba(16, 185, 129, 0.1)',
          tension: 0.3,
          fill: false
        },
        {
          label: 'Normal',
          data: [currentTotal, ...(scenarios?.normal?.projections?.map(p => p.total) || [])],
          borderColor: 'rgb(59, 130, 246)',
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          tension: 0.3,
          fill: false
        },
        {
          label: 'Agresivo',
          data: [currentTotal, ...(scenarios?.aggressive?.projections?.map(p => p.total) || [])],
          borderColor: 'rgb(249, 115, 22)',
          backgroundColor: 'rgba(249, 115, 22, 0.1)',
          tension: 0.3,
          fill: false
        },
        {
          label: 'Máximo',
          data: [currentTotal, ...(scenarios?.maximum?.projections?.map(p => p.total_if_max) || [])],
          borderColor: 'rgb(147, 51, 234)',
          backgroundColor: 'rgba(147, 51, 234, 0.1)',
          tension: 0.3,
          fill: false,
          borderDash: [5, 5]
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

