import { Controller, Get, HttpCode, HttpStatus, Inject, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  acceptedResponseSchema,
  acceptInvitationRequestSchema,
  type AcceptedResponse,
  authContextSchema,
  type AuthContext,
  authSessionResponseSchema,
  type AuthSessionResponse,
  CSRF_HEADER,
  errorResponseSchema,
  forgotPasswordRequestSchema,
  invitationPreviewSchema,
  type InvitationPreview,
  invitationTokenRequestSchema,
  isTenantSelection,
  loginRequestSchema,
  loginResponseSchema,
  type LoginResponse,
  REFRESH_COOKIE,
  refreshRequestSchema,
  registerRequestSchema,
  resetPasswordRequestSchema,
  verifyEmailRequestSchema,
} from '@pos/contracts';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { AllowWhenInactive } from '../billing/subscription.guard';
import { AppException } from '../common/app-exception';
import type { AuthPrincipal } from '../common/request-context';
import { ApiZodBody, ApiZodResponse, ZodBody } from '../common/zod';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { clearRefreshCookie, setRefreshCookie } from './auth-cookies';
import { CurrentPrincipal, Public, SelfService, SensitiveRateLimit } from './auth.decorators';
import { AuthService, type IssuedAuth } from './auth.service';
import { EmailVerificationService } from './email-verification.service';
import { PasswordResetService } from './password-reset.service';

const ACCEPTED: AcceptedResponse = { accepted: true };

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly passwordReset: PasswordResetService,
    private readonly verification: EmailVerificationService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Post('register')
  @Public()
  @SensitiveRateLimit()
  @HttpCode(HttpStatus.CREATED)
  @ApiZodBody(registerRequestSchema)
  @ApiZodResponse(
    201,
    authSessionResponseSchema,
    'Business and owner account created; owner is signed in.',
  )
  @ApiZodResponse(409, errorResponseSchema, 'EMAIL_IN_USE')
  async register(
    @ZodBody(registerRequestSchema) body: z.output<typeof registerRequestSchema>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSessionResponse> {
    return this.deliver(res, await this.auth.register(body));
  }

  @Post('login')
  @Public()
  @SensitiveRateLimit()
  @HttpCode(HttpStatus.OK)
  @ApiZodBody(loginRequestSchema)
  @ApiZodResponse(200, loginResponseSchema, 'Signed in, or a list of businesses to choose from.')
  @ApiZodResponse(401, errorResponseSchema, 'INVALID_CREDENTIALS')
  @ApiZodResponse(423, errorResponseSchema, 'ACCOUNT_LOCKED')
  async login(
    @ZodBody(loginRequestSchema) body: z.output<typeof loginRequestSchema>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    const result = await this.auth.login(body);
    return isTenantSelection(result) ? result : this.deliver(res, result);
  }

  @Post('invitations/preview')
  @Public()
  @SensitiveRateLimit()
  @HttpCode(HttpStatus.OK)
  @ApiZodBody(invitationTokenRequestSchema)
  @ApiZodResponse(200, invitationPreviewSchema, 'What the invitation offers.')
  @ApiZodResponse(400, errorResponseSchema, 'INVITATION_INVALID')
  previewInvitation(
    @ZodBody(invitationTokenRequestSchema) body: z.output<typeof invitationTokenRequestSchema>,
  ): Promise<InvitationPreview> {
    return this.auth.previewInvitation(body.token);
  }

  @Post('invitations/accept')
  @Public()
  @SensitiveRateLimit()
  @HttpCode(HttpStatus.OK)
  @ApiZodBody(acceptInvitationRequestSchema)
  @ApiZodResponse(200, authSessionResponseSchema, 'Joined the business and signed in.')
  @ApiZodResponse(400, errorResponseSchema, 'INVITATION_INVALID')
  @ApiZodResponse(401, errorResponseSchema, 'INVALID_CREDENTIALS')
  @ApiZodResponse(409, errorResponseSchema, 'ALREADY_MEMBER')
  async acceptInvitation(
    @ZodBody(acceptInvitationRequestSchema) body: z.output<typeof acceptInvitationRequestSchema>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSessionResponse> {
    return this.deliver(res, await this.auth.acceptInvitation(body));
  }

  /** Confirms the e-mail address from the emailed link. */
  @Post('email/verify')
  @Public()
  @SensitiveRateLimit()
  @HttpCode(HttpStatus.OK)
  @ApiZodBody(verifyEmailRequestSchema)
  @ApiZodResponse(200, acceptedResponseSchema)
  @ApiZodResponse(400, errorResponseSchema, 'INVALID_VERIFICATION_TOKEN')
  async verifyEmail(
    @ZodBody(verifyEmailRequestSchema) body: z.output<typeof verifyEmailRequestSchema>,
  ): Promise<AcceptedResponse> {
    await this.verification.verify(body.token);
    return ACCEPTED;
  }

  /** Sends a new verification link to the signed-in person (no-op once verified). */
  @Post('email/verification')
  @SelfService()
  @SensitiveRateLimit()
  @AllowWhenInactive()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiBearerAuth()
  @ApiZodResponse(202, acceptedResponseSchema)
  async resendVerification(
    @CurrentPrincipal() principal: AuthPrincipal,
  ): Promise<AcceptedResponse> {
    await this.verification.resend(principal.userId);
    return ACCEPTED;
  }

  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiZodBody(refreshRequestSchema)
  @ApiZodResponse(
    200,
    authSessionResponseSchema,
    'Rotated session. Web clients receive the refresh token as a cookie.',
  )
  async refresh(
    @ZodBody(refreshRequestSchema) body: z.output<typeof refreshRequestSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSessionResponse> {
    const token = this.refreshTokenFrom(body, req);
    if (!token)
      throw new AppException('SESSION_EXPIRED', HttpStatus.UNAUTHORIZED, 'No active session.');
    try {
      return this.deliver(res, await this.auth.refresh(token));
    } catch (error) {
      if (!body.refreshToken) clearRefreshCookie(res, this.config);
      throw error;
    }
  }

  @Post('logout')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiZodBody(refreshRequestSchema)
  @ApiZodResponse(200, acceptedResponseSchema)
  async logout(
    @ZodBody(refreshRequestSchema) body: z.output<typeof refreshRequestSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AcceptedResponse> {
    const token = this.refreshTokenFrom(body, req);
    if (token) await this.auth.logout(token);
    clearRefreshCookie(res, this.config);
    return ACCEPTED;
  }

  @Post('logout-all')
  @SelfService()
  @AllowWhenInactive()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiZodResponse(
    200,
    acceptedResponseSchema,
    'Every session of the current user, on every device, is revoked.',
  )
  async logoutAll(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AcceptedResponse> {
    await this.auth.logoutAll(principal);
    clearRefreshCookie(res, this.config);
    return ACCEPTED;
  }

  @Get('me')
  @SelfService()
  @ApiBearerAuth()
  @ApiZodResponse(200, authContextSchema)
  me(@CurrentPrincipal() principal: AuthPrincipal): Promise<AuthContext> {
    return this.auth.me(principal);
  }

  @Post('password/forgot')
  @Public()
  @SensitiveRateLimit()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiZodBody(forgotPasswordRequestSchema)
  @ApiZodResponse(
    202,
    acceptedResponseSchema,
    'Always accepted; an email is sent only if the account exists.',
  )
  async forgotPassword(
    @ZodBody(forgotPasswordRequestSchema) body: z.output<typeof forgotPasswordRequestSchema>,
  ): Promise<AcceptedResponse> {
    await this.passwordReset.request(body.email);
    return ACCEPTED;
  }

  @Post('password/reset')
  @Public()
  @SensitiveRateLimit()
  @HttpCode(HttpStatus.OK)
  @ApiZodBody(resetPasswordRequestSchema)
  @ApiZodResponse(200, acceptedResponseSchema, 'Password changed; all sessions revoked.')
  @ApiZodResponse(400, errorResponseSchema, 'INVALID_RESET_TOKEN or VALIDATION_FAILED')
  async resetPassword(
    @ZodBody(resetPasswordRequestSchema) body: z.output<typeof resetPasswordRequestSchema>,
  ): Promise<AcceptedResponse> {
    await this.passwordReset.reset(body.token, body.password);
    return ACCEPTED;
  }

  /**
   * Mobile sends the token in the body. Web uses the httpOnly cookie, which is only
   * accepted with the custom client header; that header forces a CORS preflight,
   * so a cross-site form post cannot drive these endpoints.
   */
  private refreshTokenFrom(body: { refreshToken?: string }, req: Request): string | undefined {
    if (body.refreshToken) return body.refreshToken;
    const cookies = req.cookies as Record<string, string | undefined> | undefined;
    const cookie = cookies?.[REFRESH_COOKIE];
    if (!cookie) return undefined;
    if (req.header(CSRF_HEADER) !== 'web') throw AppException.forbidden('Missing client header');
    return cookie;
  }

  /** Web: refresh token goes into an httpOnly cookie and is stripped from the body. */
  private deliver(res: Response, issued: IssuedAuth): AuthSessionResponse {
    const { clientType, refreshToken, ...session } = issued;
    if (clientType === 'WEB') {
      setRefreshCookie(res, this.config, refreshToken, new Date(session.refreshTokenExpiresAt));
      return session;
    }
    return { ...session, refreshToken };
  }
}
