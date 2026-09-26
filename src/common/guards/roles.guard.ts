import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { ROLES_KEY } from '../constants/security.constants';
import { AuthenticatedUser } from '../decorators/current-user.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();

    if (!user) {
      throw new ForbiddenException('Access denied. No user credentials found.');
    }

    // ADMIN is a superuser for management-level endpoints (anything a TEACHER
    // can do, ADMIN can too). Student-only actions stay student-only because
    // their business logic depends on a studentProfile the admin doesn't have.
    if (
      user.role === Role.ADMIN &&
      (requiredRoles.includes(Role.TEACHER) || requiredRoles.includes(Role.ADMIN))
    ) {
      return true;
    }

    const hasRole = requiredRoles.includes(user.role as Role);

    if (!hasRole) {
      throw new ForbiddenException(
        `Access denied. Requires one of the following roles: [${requiredRoles.join(', ')}].`,
      );
    }

    return true;
  }
}
