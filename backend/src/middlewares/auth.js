import { AuthorizationError } from '../utils/errors.js';

/**
 * Role-Based Access Control Middleware
 * Supports Header-based auth (`x-user-role: admin`, `x-user-name`) or Basic Auth
 */
export function authenticate(req, res, next) {
  const roleHeader = req.headers['x-user-role'];
  const userNameHeader = req.headers['x-user-name'];
  const authHeader = req.headers['authorization'];

  let role = 'USER';
  let user = 'anonymous';

  if (roleHeader) {
    role = roleHeader.toUpperCase();
    user = userNameHeader || 'system_user';
  } else if (authHeader && authHeader.startsWith('Basic ')) {
    const credentials = Buffer.from(authHeader.split(' ')[1], 'base64').toString('ascii');
    const [username, password] = credentials.split(':');
    if (username === 'admin' && (password === 'admin123' || password === 'admin')) {
      role = 'ADMIN';
      user = username;
    }
  }

  req.user = {
    username: user,
    role
  };

  next();
}

/**
 * Middleware ensuring user has required role (e.g. 'ADMIN')
 */
export function requireRole(requiredRole = 'ADMIN') {
  return (req, res, next) => {
    authenticate(req, res, () => {
      if (req.user?.role !== requiredRole && req.user?.role !== 'SUPERADMIN') {
        return next(new AuthorizationError(
          `Access denied. This operation requires '${requiredRole}' role privilege. Please provide header 'x-user-role: ${requiredRole.toLowerCase()}'.`
        ));
      }
      next();
    });
  };
}

