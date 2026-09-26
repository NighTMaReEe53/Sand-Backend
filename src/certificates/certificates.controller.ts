import { Controller, Get, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CertificatesService } from './certificates.service';

@ApiTags('Certificates')
@Controller('certificates')
export class CertificatesController {
  constructor(private readonly certificatesService: CertificatesService) {}

  // ─── PUBLIC: anyone can verify a certificate is genuine ────────
  @Public()
  @Get(':certificateCode/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Public certificate verification. Returns display fields only — no sensitive data.',
  })
  @ApiParam({ name: 'certificateCode', example: 'CERT-AB3D-EF9K' })
  verify(@Param('certificateCode') certificateCode: string) {
    return this.certificatesService.verify(certificateCode);
  }

  @Roles(Role.STUDENT)
  @Get('my-certificates')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'List the student certificates.' })
  getMyCertificates(@CurrentUser('id') userId: string) {
    return this.certificatesService.getMyCertificates(userId);
  }
}
