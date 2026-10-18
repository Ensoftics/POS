import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  listNotificationsQuerySchema,
  type Notification,
  type NotificationPage,
  notificationPageSchema,
  type NotificationPreferences,
  notificationPreferencesSchema,
  notificationSchema,
  type UnreadCount,
  unreadCountSchema,
} from '@pos/contracts';
import type { z } from 'zod';
import { CurrentPrincipal, SelfService } from '../auth/auth.decorators';
import { AllowWhenInactive } from '../billing/subscription.guard';
import { AppException } from '../common/app-exception';
import type { AuthPrincipal } from '../common/request-context';
import { ApiZodBody, ApiZodQuery, ApiZodResponse, ZodBody, ZodQuery } from '../common/zod';
import { NotificationsService } from './notifications.service';

const uuidParam = new ParseUUIDPipe({ exceptionFactory: () => AppException.notFound() });

/** Everyone's own notifications; reading them stays possible while an account is read-only. */
@ApiTags('Notifications')
@ApiBearerAuth()
@Controller()
@AllowWhenInactive()
@SelfService()
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('notifications')
  @ApiZodQuery(listNotificationsQuerySchema)
  @ApiZodResponse(200, notificationPageSchema)
  list(
    @CurrentPrincipal() p: AuthPrincipal,
    @ZodQuery(listNotificationsQuerySchema) query: z.output<typeof listNotificationsQuerySchema>,
  ): Promise<NotificationPage> {
    return this.notifications.list(p, query);
  }

  @Get('notifications/unread-count')
  @ApiZodResponse(200, unreadCountSchema)
  async unread(@CurrentPrincipal() p: AuthPrincipal): Promise<UnreadCount> {
    return { unread: await this.notifications.unreadCount(p) };
  }

  @Post('notifications/:id/read')
  @HttpCode(HttpStatus.OK)
  @ApiZodResponse(200, notificationSchema)
  read(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuidParam) id: string,
  ): Promise<Notification> {
    return this.notifications.markRead(p, id);
  }

  @Post('notifications/read-all')
  @HttpCode(HttpStatus.OK)
  @ApiZodResponse(200, unreadCountSchema, 'Unread count after marking (always 0).')
  async readAll(@CurrentPrincipal() p: AuthPrincipal): Promise<UnreadCount> {
    await this.notifications.markAllRead(p);
    return { unread: 0 };
  }

  @Get('me/notification-preferences')
  @ApiZodResponse(200, notificationPreferencesSchema)
  preferences(@CurrentPrincipal() p: AuthPrincipal): Promise<NotificationPreferences> {
    return this.notifications.preferences(p);
  }

  @Put('me/notification-preferences')
  @ApiZodBody(notificationPreferencesSchema)
  @ApiZodResponse(200, notificationPreferencesSchema)
  setPreferences(
    @CurrentPrincipal() p: AuthPrincipal,
    @ZodBody(notificationPreferencesSchema) body: NotificationPreferences,
  ): Promise<NotificationPreferences> {
    return this.notifications.setPreferences(p, body);
  }
}
