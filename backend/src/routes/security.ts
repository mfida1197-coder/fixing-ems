import { Router } from "express";
import { AuthedRequest, requireAuth, requirePermission } from "../middleware/auth";
import { SuperPasswordError, verifySuperPassword, superAuthorizedUntil, grantSuperAuthorization } from "../security/superPassword";

const router = Router();
router.get("/super-password/status", requireAuth, requirePermission("super_password:use"), (req: AuthedRequest, res) => {
  const until = superAuthorizedUntil(req.user!.id, req.user!.sessionKey);
  res.json({ authorized: until !== null, authorized_until: until });
});

router.post("/super-password/verify", requireAuth, requirePermission("super_password:use"), async (req: AuthedRequest, res, next) => {
  try {
    await verifySuperPassword(
      req.user!.id,
      typeof req.body?.password === "string" ? req.body.password : "",
      req.ip ?? null,
    );
    const until = grantSuperAuthorization(req.user!.id, req.user!.sessionKey);
    res.json({ ok: true, authorized_until: until });
  } catch (error) {
    if (error instanceof SuperPasswordError) {
      return res.status(error.status).json({ error: error.message });
    }
    next(error);
  }
});

export default router;
