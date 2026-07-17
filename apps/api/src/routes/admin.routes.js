import { Router } from 'express';

import { getAdminUsers, patchAdminUserRole } from '../controllers/adminUser.controller.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { expensiveMutationRateLimiter } from '../middleware/rateLimit.middleware.js';
import { requireRole } from '../middleware/role.middleware.js';

const router = Router();
const requireAdmin = requireRole('admin');

router.use(authMiddleware);
router.use(requireAdmin);
router.get('/users', getAdminUsers);
router.patch('/users/:id/role', expensiveMutationRateLimiter, patchAdminUserRole);

export default router;
