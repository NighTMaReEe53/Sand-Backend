import { SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';
import { ROLES_KEY } from '../constants/security.constants';

export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
