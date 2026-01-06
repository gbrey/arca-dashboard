// Función helper para obtener si el usuario es admin
function getIsAdmin() {
  const userStr = localStorage.getItem('user');
  if (userStr) {
    try {
      const user = JSON.parse(userStr);
      return user.is_admin === true;
    } catch (e) {
      return false;
    }
  }
  return false;
}

