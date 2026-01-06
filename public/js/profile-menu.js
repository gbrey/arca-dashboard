// Componente compartido para el menú de perfil y resetear contraseña
function profileMenuComponent() {
  return {
    showProfileMenu: false,
    showResetPasswordModal: false,
    resettingPassword: false,
    resetPasswordError: '',
    resetPasswordSuccess: '',
    resetPasswordForm: {
      current_password: '',
      new_password: '',
      confirm_password: ''
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

