import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { EmailVerificationService } from './email-verification.service';
import { AccessTokenGuard } from './guards/access-token.guard';
import { PermissionsGuard } from './guards/permissions.guard';
import { PasswordHasher } from './password-hasher';
import { PasswordResetService } from './password-reset.service';
import { SessionService } from './session.service';
import { JWT_AUDIENCE, JWT_ISSUER, TokenService } from './token.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        secret: config.JWT_ACCESS_SECRET,
        signOptions: { algorithm: 'HS256', issuer: JWT_ISSUER, audience: JWT_AUDIENCE },
        verifyOptions: { algorithms: ['HS256'], issuer: JWT_ISSUER, audience: JWT_AUDIENCE },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    EmailVerificationService,
    PasswordHasher,
    PasswordResetService,
    SessionService,
    TokenService,
    AccessTokenGuard,
    PermissionsGuard,
  ],
  // Guards are registered globally (in a fixed order) by AppModule.
  exports: [
    JwtModule,
    AccessTokenGuard,
    PermissionsGuard,
    SessionService,
    TokenService,
    PasswordHasher,
    EmailVerificationService,
  ],
})
export class AuthModule {}
