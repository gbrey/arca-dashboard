function adminApp() {
  return {
    loading: true,
    isAdmin: false,
    activeTab: 'users',
    users: [],
    error: '',
    success: '',
    
    // Password modal
    showPasswordModal: false,
    selectedUser: null,
    newPassword: '',
    
    // Limits
    limits: [],
    showLimitsForm: false,
    editingLimitId: null,
    limitsError: '',
    limitForm: {
      period: '',
      valid_from: '',
      limits: { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, G: 0, H: 0, I: 0, J: 0, K: 0 },
      source: '',
      ipc_months: [0, 0, 0, 0, 0, 0] // IPC de los últimos 6 meses
    },
    
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
      const token = localStorage.getItem('token');
      if (!token) {
        window.location.href = '/login.html';
        return;
      }
      
      // Verificar si es admin (del login)
      const userStr = localStorage.getItem('user');
      if (userStr) {
        const user = JSON.parse(userStr);
        this.isAdmin = user.is_admin === true;
      }
      
      if (!this.isAdmin) {
        this.loading = false;
        return;
      }
      
      await this.loadUsers();
      await this.loadLimits();
      this.loading = false;
    },
    
    async loadUsers() {
      try {
        const response = await fetch('/api/admin/users', {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });
        
        if (response.ok) {
          const data = await response.json();
          this.users = data.users || [];
        }
      } catch (error) {
        console.error('Error loading users:', error);
      }
    },
    
    async blockUser(user) {
      if (!confirm(`¿Bloquear a ${user.email}?`)) return;
      
      try {
        const response = await fetch(`/api/admin/users/${user.id}`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ is_blocked: 1 })
        });
        
        if (response.ok) {
          this.success = 'Usuario bloqueado';
          setTimeout(() => this.success = '', 3000);
          await this.loadUsers();
        } else {
          const data = await response.json();
          this.error = data.error || 'Error al bloquear usuario';
        }
      } catch (error) {
        this.error = 'Error al bloquear usuario';
      }
    },
    
    async unblockUser(user) {
      try {
        const response = await fetch(`/api/admin/users/${user.id}`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ is_blocked: 0 })
        });
        
        if (response.ok) {
          this.success = 'Usuario desbloqueado';
          setTimeout(() => this.success = '', 3000);
          await this.loadUsers();
        } else {
          const data = await response.json();
          this.error = data.error || 'Error al desbloquear usuario';
        }
      } catch (error) {
        this.error = 'Error al desbloquear usuario';
      }
    },
    
    openChangePassword(user) {
      this.selectedUser = user;
      this.newPassword = '';
      this.showPasswordModal = true;
    },
    
    async changePassword() {
      if (!this.selectedUser || !this.newPassword) return;
      
      try {
        const response = await fetch(`/api/admin/users/${this.selectedUser.id}`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ new_password: this.newPassword })
        });
        
        if (response.ok) {
          this.success = 'Contraseña actualizada';
          setTimeout(() => this.success = '', 3000);
          this.showPasswordModal = false;
          this.newPassword = '';
          this.selectedUser = null;
        } else {
          const data = await response.json();
          this.error = data.error || 'Error al cambiar contraseña';
        }
      } catch (error) {
        this.error = 'Error al cambiar contraseña';
      }
    },
    
    async loadLimits() {
      try {
        const response = await fetch('/api/recategorization/limits');
        if (response.ok) {
          const data = await response.json();
          this.limits = data.limits || [];
        }
      } catch (error) {
        console.error('Error loading limits:', error);
      }
    },
    
    editLimit(limit) {
      this.editingLimitId = limit.id;
      this.limitForm = {
        period: limit.period,
        valid_from: new Date(limit.valid_from * 1000).toISOString().split('T')[0],
        limits: { ...limit.limits },
        source: limit.source || '',
        ipc_months: [0, 0, 0, 0, 0, 0] // No se usa en edición
      };
      this.showLimitsForm = true;
    },
    
    calculateAccumulatedIPC() {
      // Calcular IPC acumulado: (1 + ipc1/100) * (1 + ipc2/100) * ... - 1
      let accumulated = 1;
      for (const ipc of this.limitForm.ipc_months) {
        if (ipc && ipc !== 0) {
          accumulated *= (1 + ipc / 100);
        }
      }
      return ((accumulated - 1) * 100).toFixed(2);
    },
    
    async saveLimits() {
      try {
        const validFromDate = new Date(this.limitForm.valid_from);
        const validFromTimestamp = Math.floor(validFromDate.getTime() / 1000);
        
        // Preparar datos, incluyendo IPC si está especificado
        const requestData = {
          period: this.limitForm.period,
          valid_from: validFromTimestamp,
          limits: this.limitForm.limits,
          source: this.limitForm.source
        };
        
        // Solo incluir IPC si hay valores y no es edición
        const hasIPC = this.limitForm.ipc_months.some(ipc => ipc && ipc !== 0);
        if (!this.editingLimitId && hasIPC) {
          requestData.ipc_months = this.limitForm.ipc_months;
        }
        
        const response = await fetch('/api/recategorization/limits', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(requestData)
        });
        
        if (response.ok) {
          this.success = 'Límites guardados';
          setTimeout(() => this.success = '', 3000);
          this.cancelLimitsForm();
          await this.loadLimits();
        } else {
          const data = await response.json();
          this.limitsError = data.error || 'Error al guardar límites';
        }
      } catch (error) {
        this.limitsError = 'Error al guardar límites';
      }
    },
    
    cancelLimitsForm() {
      this.showLimitsForm = false;
      this.editingLimitId = null;
      this.limitForm = {
        period: '',
        valid_from: '',
        limits: { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, G: 0, H: 0, I: 0, J: 0, K: 0 },
        source: '',
        ipc_months: [0, 0, 0, 0, 0, 0]
      };
      this.limitsError = '';
    },
    
    formatDate(timestamp) {
      if (!timestamp) return '-';
      return new Date(timestamp * 1000).toLocaleDateString('es-AR');
    },
    
    formatPeriod(period) {
      if (!period) return '-';
      const [year, month] = period.split('-');
      return month === '01' ? `Enero ${year}` : `Julio ${year}`;
    },
    
    logout() {
      localStorage.removeItem('token');
      localStorage.removeItem('selectedAccountId');
      localStorage.removeItem('user');
      window.location.href = '/login.html';
    }
  };
}

